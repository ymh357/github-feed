import { getDb, queryRows } from "./db";

export interface RecoveryOptions {
  revision: string;
  before: string;
  limit: number;
  repository?: string;
  apply?: boolean;
  verifiedSourceEventIds?: readonly string[];
}

export interface RecoveryItem {
  contentId: string;
  eventId: string;
  repository: string;
  previousAttempts: number;
}

export const recoverContent = async (options: RecoveryOptions): Promise<RecoveryItem[]> => {
  const cutoff = Date.parse(options.before);
  if (!/^github-learning-\d+$/.test(options.revision) || !Number.isFinite(cutoff) || cutoff > Date.now()
    || !Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 200
    || (options.repository !== undefined && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository))) {
    throw new Error("恢复参数无效：必须提供已发生的截止时间、有效修复版本和1..200项上限。");
  }
  const verifiedSourceEventIds = options.verifiedSourceEventIds ?? [];
  if (verifiedSourceEventIds.length > 20 || verifiedSourceEventIds.some((id) => !/^[A-Za-z0-9_-]{1,250}$/.test(id))) {
    throw new Error("已核验资料标识无效。");
  }
  const params = [options.revision, new Date(cutoff).toISOString(), options.limit, options.repository ?? null, verifiedSourceEventIds];
  const candidates = `SELECT c.*,e.id AS recovery_event_id,r.full_name FROM learning_contents c
    JOIN feed_events e ON e.id=c.event_id JOIN repositories r ON r.id=e.repository_id
    WHERE ((c.status='failed' AND c.attempts>=3 AND (c.error_kind='validation'
          OR (c.error_kind='transient' AND c.error_summary='0G 服务故障，后续事实复核已暂停。')))
      OR (c.status IN ('failed','insufficient_sources') AND c.error_kind='source' AND c.event_id=ANY($5::text[])))
      AND c.updated_at<$2::timestamptz AND r.is_active AND r.admission_status='eligible' AND r.stars>=1000
      AND c.last_attempt_revision IS DISTINCT FROM $1
      AND e.digest_event_id IS NULL AND (e.kind<>'release' OR e.importance<>'minor' OR c.article IS NOT NULL)
      AND ($4::text IS NULL OR lower(r.full_name)=lower($4))
      AND NOT EXISTS(SELECT 1 FROM content_recoveries h WHERE h.content_id=c.id AND h.repair_revision=$1)
    ORDER BY c.updated_at,c.id LIMIT $3`;
  const rows = options.apply
    ? (await getDb().transaction([
      getDb().query(`WITH candidates AS MATERIALIZED (${candidates} FOR UPDATE OF c SKIP LOCKED),
        archived AS (
          INSERT INTO content_recoveries(content_id,repair_revision,previous_status,previous_attempts,
            previous_error_kind,previous_error_summary,previous_next_retry_at,previous_updated_at,previous_attempt_revision)
          SELECT id,$1,status,attempts,error_kind,error_summary,next_retry_at,updated_at,last_attempt_revision FROM candidates
          ON CONFLICT DO NOTHING RETURNING content_id
        ), recovered AS (
          UPDATE learning_contents c SET status='pending',attempts=0,error_kind=NULL,error_summary=NULL,
            next_retry_at=NULL,lease_token=NULL,lease_until=NULL,updated_at=now()
          FROM archived a WHERE c.id=a.content_id RETURNING c.id
        ) SELECT p.id,p.recovery_event_id,p.full_name,p.attempts FROM candidates p
          JOIN recovered r ON r.id=p.id`, params),
    ]))[0]
    : await queryRows(candidates, params);
  return rows.map((row) => ({ contentId: String(row.id), eventId: String(row.recovery_event_id),
    repository: String(row.full_name), previousAttempts: Number(row.attempts) }));
};
