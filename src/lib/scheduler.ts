import { getDb, LEARNING_EVENT_FILTER, type DbRow } from "./db";

export const SCHEDULED_STAGES = ["discover", "sync", "generate"] as const;
export type ScheduledStage = typeof SCHEDULED_STAGES[number];
export const STAGE_INTERVAL_MS: Record<ScheduledStage, number> = { generate: 3 * 3600_000, sync: 6 * 3600_000, discover: 6 * 3600_000 };
const RETRY_DELAY_MS = 45 * 60_000;
const RUNNING_GRACE_MS = 35 * 60_000;

export interface StageObservation {
  lastAttemptAt: string | null;
  lastCompletedAt: string | null;
  lastProducedAt: string | null;
  runningSince: string | null;
  leaseUntil: string | null;
  readyFirstPublications?: number;
}

export interface StageSchedule extends StageObservation {
  stage: ScheduledStage;
  due: boolean;
  busy: boolean;
  nextDueAt: string;
  reason: string;
}

const timestamp = (value: string | null): number => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
export const evaluateStage = (stage: ScheduledStage, observation: StageObservation, now = Date.now()): StageSchedule => {
  const completed = timestamp(observation.lastCompletedAt);
  const attempted = timestamp(observation.lastAttemptAt);
  const running = timestamp(observation.runningSince);
  const leaseUntil = timestamp(observation.leaseUntil);
  const backlog = stage === "generate" && (observation.readyFirstPublications ?? 0) > 0;
  const retryDelay = backlog && completed > 0 && completed >= attempted ? 0 : RETRY_DELAY_MS;
  const nextDue = Math.max(completed ? completed + (backlog ? 0 : STAGE_INTERVAL_MS[stage]) : 0,
    attempted ? attempted + retryDelay : 0);
  const busy = leaseUntil > now || (running > 0 && running + RUNNING_GRACE_MS > now);
  const nextAvailable = busy ? Math.max(nextDue, leaseUntil, running ? running + RUNNING_GRACE_MS : 0) : nextDue;
  return { ...observation, stage, busy, due: !busy && now >= nextDue, nextDueAt: new Date(nextAvailable || now).toISOString(),
    reason: busy ? "阶段已有租约或近期运行，等待释放" : now < nextDue ? "尚未到期或处于失败重试间隔" : backlog ? "有可领取的首次发布积压，需要继续生成" : completed ? "阶段已到期，需要追赶" : "没有有效完成水位，需要补跑" };
};

const schedulerQuery = async (sql: string, params: unknown[] = []): Promise<DbRow[]> =>
  await getDb().query(sql, params, { fetchOptions: { signal: AbortSignal.timeout(15_000) } }) as DbRow[];

export const readStageSchedule = async (now = Date.now()): Promise<StageSchedule[]> => {
  const [runs, leases, backlog] = await Promise.all([
    schedulerQuery(`WITH parsed AS (
      SELECT status,started_at,finished_at,generated,discovered,
        CASE WHEN discovery_scope IS JSON OBJECT THEN discovery_scope::jsonb ELSE '{}'::jsonb END AS scope
      FROM collection_runs
    ), matched AS (
      SELECT s.stage,p.*,NULLIF(p.scope->>'repository','') IS NULL AS global_run
      FROM parsed p CROSS JOIN unnest($1::text[]) AS s(stage)
      WHERE (p.scope->>'stage'=s.stage OR p.scope->>'stage'='all')
        AND (s.stage<>'generate' OR p.scope->>'generatesContent' IS DISTINCT FROM 'false')
    ) SELECT stage,
      max(started_at) FILTER (WHERE global_run) AS last_attempt_at,
      max(finished_at) FILTER (WHERE global_run AND
        ((stage='generate' AND status IN ('completed','partial') AND generated>0
          AND scope->>'infrastructureFailure' IS DISTINCT FROM 'true')
        OR (stage<>'generate' AND (status='completed' OR (status='partial' AND stage='discover' AND discovered>0))))) AS last_completed_at,
      max(finished_at) FILTER (WHERE stage='generate' AND generated>0) AS last_produced_at,
      max(started_at) FILTER (WHERE status='running') AS running_since
      FROM matched GROUP BY stage`, [[...SCHEDULED_STAGES]]),
    schedulerQuery("SELECT stage,lease_until FROM collection_stage_leases"),
    schedulerQuery(`SELECT count(*) AS ready FROM learning_contents c JOIN feed_events e ON e.id=c.event_id
      JOIN repositories r ON r.id=e.repository_id WHERE r.is_active AND r.admission_status='eligible'
      AND r.stars>=1000 AND ${LEARNING_EVENT_FILTER} AND c.article IS NULL AND c.attempts<3
      AND c.error_kind IS DISTINCT FROM 'source' AND (c.next_retry_at IS NULL OR c.next_retry_at<=now())
      AND (c.status IN ('pending','failed','insufficient_sources') OR (c.status='processing' AND c.lease_until<now()))`),
  ]);
  const nullableDate = (value: unknown): string | null => value ? (value instanceof Date ? value.toISOString() : String(value)) : null;
  return SCHEDULED_STAGES.map((stage) => {
    const row = runs.find((entry) => entry.stage === stage);
    const lease = leases.find((entry) => entry.stage === stage);
    return evaluateStage(stage, { lastAttemptAt: nullableDate(row?.last_attempt_at), lastCompletedAt: nullableDate(row?.last_completed_at),
      lastProducedAt: nullableDate(row?.last_produced_at), runningSince: nullableDate(row?.running_since), leaseUntil: nullableDate(lease?.lease_until),
      readyFirstPublications: stage === "generate" ? Number(backlog[0]?.ready ?? 0) : 0 }, now);
  });
};

export const acquireStageLease = async (stage: ScheduledStage, token: string): Promise<boolean> => {
  const rows = await schedulerQuery(`INSERT INTO collection_stage_leases(stage,lease_token,lease_until)
    VALUES($1,$2,now()+interval '2 minutes')
    ON CONFLICT(stage) DO UPDATE SET lease_token=EXCLUDED.lease_token,lease_until=EXCLUDED.lease_until
    WHERE collection_stage_leases.lease_until<=now() RETURNING stage`, [stage, token]);
  return rows.length === 1;
};

export const renewStageLease = async (stage: ScheduledStage, token: string): Promise<boolean> => {
  const rows = await schedulerQuery(`UPDATE collection_stage_leases SET lease_until=now()+interval '2 minutes'
    WHERE stage=$1 AND lease_token=$2 AND lease_until>now() RETURNING stage`, [stage, token]);
  return rows.length === 1;
};

export const releaseStageLease = async (stage: ScheduledStage, token: string): Promise<void> => {
  await schedulerQuery("DELETE FROM collection_stage_leases WHERE stage=$1 AND lease_token=$2", [stage, token]);
};
