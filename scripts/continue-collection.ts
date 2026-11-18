import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getDb, LEARNING_EVENT_FILTER, type DbRow } from "../src/lib/db";

export const MAX_CONTINUATION_JOBS = 12;

export interface ContinuationContext {
  runId: string;
  runAttempt: string;
  jobSucceeded: boolean;
  eventName: string;
  requestedStage: string;
  requestedDepth: string;
  repository: string;
  discoveryOnly: boolean;
  continuationDepth: string;
}

export interface ContinuationEvidence {
  matchedRuns: number;
  firstPublications: number;
  sourceValid: boolean;
  claimableFirstPublications: number;
}

export const continuationDecision = (context: ContinuationContext, evidence: ContinuationEvidence): { proceed: boolean; reason: string; nextDepth: number | null } => {
  const stop = (reason: string): { proceed: false; reason: string; nextDepth: null } => ({ proceed: false, reason, nextDepth: null });
  if (!context.jobSucceeded) return stop("当前 job 未确认成功，不续跑。");
  if (!/^\d+$/.test(context.runId) || !/^[1-9]\d*$/.test(context.runAttempt)) return stop("缺少可精确关联的 GitHub run/attempt，不续跑。");
  if (!["schedule", "workflow_dispatch"].includes(context.eventName)) return stop("当前触发类型不支持自动续跑。");
  if (!["all", "generate"].includes(context.requestedStage) || context.repository || context.discoveryOnly || !["both", "quick"].includes(context.requestedDepth)) return stop("定向、深入专批或非生成任务不启动全局续跑。");
  if (!/^(0|[1-9]\d*)$/.test(context.continuationDepth)) return stop("续跑深度无效，不续跑。");
  const depth = Number(context.continuationDepth);
  if (!Number.isSafeInteger(depth) || depth >= MAX_CONTINUATION_JOBS - 1) return stop(`本条链已达到最多 ${MAX_CONTINUATION_JOBS} 个 job 的边界。`);
  if (!evidence.sourceValid || !Number.isSafeInteger(evidence.matchedRuns) || evidence.matchedRuns < 1) return stop("本 run/attempt 没有完整且无基础故障的全局生成记录，不续跑。");
  if (!Number.isSafeInteger(evidence.firstPublications) || evidence.firstPublications < 1) return stop("本批没有新增首发文章；旧文刷新不会触发续跑。");
  if (!Number.isSafeInteger(evidence.claimableFirstPublications) || evidence.claimableFirstPublications < 1) return stop("没有现在可领取的首发积压；退避、资料错误或正在处理的任务不触发续跑。");
  return { proceed: true, reason: `本批首发 ${evidence.firstPublications} 篇，仍有 ${evidence.claimableFirstPublications} 项可领取首发内容。`, nextDepth: depth + 1 };
};

export const readContinuationEvidence = async (runId: string, runAttempt: string): Promise<ContinuationEvidence> => {
  const query = async (sql: string, params: unknown[] = []): Promise<DbRow[]> =>
    await getDb().query(sql, params, { fetchOptions: { signal: AbortSignal.timeout(15_000) } }) as DbRow[];
  const [runs, pending] = await Promise.all([
    query(`WITH parsed AS (
      SELECT id,status,finished_at,generated,CASE WHEN discovery_scope IS JSON OBJECT THEN discovery_scope::jsonb ELSE '{}'::jsonb END AS scope
      FROM collection_runs
    ) SELECT id,status,finished_at,generated,scope->>'generatedFirstPublications' AS first_publications,
      scope->>'infrastructureFailure' AS infrastructure_failure
      FROM parsed WHERE scope->>'githubRunId'=$1 AND scope->>'githubRunAttempt'=$2
        AND scope->>'stage' IN ('all','generate') AND scope->>'generatesContent'='true'
        AND NULLIF(scope->>'repository','') IS NULL`, [runId, runAttempt]),
    query(`SELECT count(*)::integer AS count FROM feed_events e
      JOIN repositories r ON r.id=e.repository_id JOIN learning_contents c ON c.event_id=e.id
      WHERE r.is_active AND r.admission_status='eligible' AND r.stars>=1000 AND ${LEARNING_EVENT_FILTER}
        AND c.article IS NULL AND c.attempts<3 AND c.error_kind IS DISTINCT FROM 'source'
        AND (c.next_retry_at IS NULL OR c.next_retry_at<=now())
        AND (c.status IN ('pending','failed','insufficient_sources') OR (c.status='processing' AND c.lease_until<now()))`),
  ]);
  let firstPublications = 0;
  const sourceValid = runs.length > 0 && runs.every((run) => {
    const count = typeof run.first_publications === "string" && /^\d+$/.test(run.first_publications) ? Number(run.first_publications) : NaN;
    const generated = Number(run.generated);
    if (!Number.isSafeInteger(generated) || generated < 0 || !Number.isSafeInteger(count) || count < 0 || count > generated || !run.finished_at
      || !["completed", "partial"].includes(String(run.status)) || run.infrastructure_failure !== "false") return false;
    firstPublications += count;
    return true;
  });
  return { matchedRuns: runs.length, firstPublications: sourceValid ? firstPublications : 0, sourceValid, claimableFirstPublications: Number(pending[0]?.count ?? 0) };
};

export const dispatchContinuation = async (repository: string, ref: string, token: string, nextDepth: number): Promise<number> => {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || (!ref.startsWith("refs/heads/") || ref.length <= "refs/heads/".length) || !token
    || !Number.isSafeInteger(nextDepth) || nextDepth < 1 || nextDepth >= MAX_CONTINUATION_JOBS) throw new Error("续跑目标或深度无效，未发送请求。");
  let response: Response;
  try {
    response = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/collect.yml/dispatches`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ref: ref.slice("refs/heads/".length), inputs: { stage: "generate", depth: "both", limit: "200", repository: "", discovery_only: "false", continuation_depth: String(nextDepth) } }),
    });
  } catch { throw new Error("续跑请求失败或超时，未自动重试；服务端可能已接收，请在 Actions 核对。"); }
  if (!response.ok) throw new Error(`续跑请求被 GitHub 拒绝（HTTP ${response.status}），未自动重试。`);
  return response.status;
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  if (args.includes("--help")) { console.log("用法：node --env-file-if-exists=.env.local --import tsx scripts/continue-collection.ts [--dry-run]\n根据 GITHUB_RUN_ID/GITHUB_RUN_ATTEMPT 精确关联当前批次；仅首发成功且还有可领取首发积压才单次请求下一批。--dry-run 只读，不触发工作流。"); return; }
  if (args.some((arg) => arg !== "--dry-run")) throw new Error("续跑参数无效，请使用 --help。");
  const context: ContinuationContext = {
    runId: process.env.GITHUB_RUN_ID ?? "", runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
    jobSucceeded: process.env.SOURCE_JOB_SUCCEEDED === "true", eventName: process.env.EVENT_NAME ?? "",
    requestedStage: process.env.REQUESTED_STAGE ?? "all", requestedDepth: process.env.REQUESTED_DEPTH ?? "both",
    repository: process.env.REQUESTED_REPOSITORY ?? "", discoveryOnly: process.env.DISCOVERY_ONLY === "true", continuationDepth: process.env.CONTINUATION_DEPTH ?? "0",
  };
  if (!/^\d+$/.test(context.runId) || !/^[1-9]\d*$/.test(context.runAttempt)) throw new Error("续跑检查需要精确的 GitHub run/attempt，未查询或触发工作流。");
  const evidence = await readContinuationEvidence(context.runId, context.runAttempt);
  const decision = continuationDecision(context, evidence);
  console.log(JSON.stringify({ mode: args.includes("--dry-run") ? "read-only" : "continuation-check", ...evidence, ...decision }));
  if (args.includes("--dry-run")) return;
  let status: number | null = null;
  if (decision.proceed) status = await dispatchContinuation(process.env.GITHUB_REPOSITORY ?? "", process.env.GITHUB_REF ?? "", process.env.GITHUB_TOKEN ?? "", decision.nextDepth!);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### 首发积压续跑\n\n${decision.reason}\n\n${status ? `已请求下一批 generate / both / 200；链深度 ${decision.nextDepth}，最多 ${MAX_CONTINUATION_JOBS} 个 job。` : "未触发后继任务。"}\n`);
};

if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/continue-collection.ts")) {
  main().catch((error: unknown) => { console.error(error instanceof Error && /^续跑/.test(error.message) ? error.message : "续跑检查失败，未自动重试；请检查阶段记录与权限。"); process.exitCode = 1; });
}
