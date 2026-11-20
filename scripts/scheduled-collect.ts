import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { acquireStageLease, evaluateStage, readStageSchedule, releaseStageLease, renewStageLease, SCHEDULED_STAGES, type ScheduledStage } from "../src/lib/scheduler";

export interface ChildResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  leaseLost: boolean;
  interrupted: boolean;
  startFailed: boolean;
}

export const superviseChild = (child: ChildProcess, options: {
  timeoutMs: number;
  renewLease: () => Promise<boolean>;
  renewEveryMs?: number;
  killGraceMs?: number;
}): Promise<ChildResult> => new Promise((resolveResult) => {
  const result: ChildResult = { code: null, signal: null, timedOut: false, leaseLost: false, interrupted: false, startFailed: false };
  let closed = false;
  let stopping = false;
  let renewal: Promise<void> | null = null;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const stop = (): void => {
    if (closed || stopping) return;
    stopping = true;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => { if (!closed) child.kill("SIGKILL"); }, options.killGraceMs ?? 5000);
  };
  const onInterrupt = (): void => { result.interrupted = true; stop(); };
  process.once("SIGTERM", onInterrupt);
  process.once("SIGINT", onInterrupt);
  const timeout = setTimeout(() => { result.timedOut = true; stop(); }, options.timeoutMs);
  const heartbeat = setInterval(() => {
    if (closed || stopping || renewal) return;
    renewal = Promise.resolve().then(options.renewLease).then((renewed) => {
      if (!renewed && !closed) { result.leaseLost = true; stop(); }
    }).catch(() => {
      if (!closed) { result.leaseLost = true; stop(); }
    }).finally(() => { renewal = null; });
  }, options.renewEveryMs ?? 30_000);
  child.once("error", () => { result.startFailed = true; });
  child.once("close", (code, signal) => {
    closed = true;
    result.code = code;
    result.signal = signal;
    clearTimeout(timeout);
    clearInterval(heartbeat);
    if (killTimer) clearTimeout(killTimer);
    process.removeListener("SIGTERM", onInterrupt);
    process.removeListener("SIGINT", onInterrupt);
    // Finish any already-started renewal before the caller releases this token.
    if (renewal) void renewal.finally(() => resolveResult(result));
    else resolveResult(result);
  });
});

const STAGE_BUDGET_SECONDS: Record<ScheduledStage, number> = { generate: 1080, sync: 300, discover: 300 };
export const stageRuntimeSeconds = (stage: ScheduledStage, remainingSeconds: number): number | null => {
  const runtime = Math.min(STAGE_BUDGET_SECONDS[stage], Math.floor(remainingSeconds) - 30);
  return runtime >= (stage === "generate" ? 660 : 300) ? runtime : null;
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("用法：node --env-file-if-exists=.env.local --import tsx scripts/scheduled-collect.ts [--scheduled] [--dry-run] [--stage all|discover|sync|generate] [--depth quick|deep] [--repository owner/name] [--limit 1..200] [--discovery-only]\n--scheduled：检查数据库中到期阶段并补跑。默认人工强制执行指定阶段，但仍遵守阶段租约。\n--dry-run：只读阶段到期情况，不申请租约、不采集、不调用模型。GitHub 唤醒可能延迟或漏掉，此工具只在获得唤醒后追赶。");
    return;
  }
  const flags = new Set(["--scheduled", "--dry-run", "--discovery-only"]);
  const values = new Set(["--stage", "--depth", "--repository", "--limit"]);
  const input: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    if (flags.has(args[index])) continue;
    if (!values.has(args[index]) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("调度参数无效，请使用 --help。");
    input[args[index]] = args[++index];
  }
  const scheduled = args.includes("--scheduled");
  const selectedStage = input["--stage"] ?? "all";
  const repository = input["--repository"] ?? "";
  const depth = input["--depth"] ?? "";
  const limit = Number(input["--limit"] ?? "50");
  if (!["all", ...SCHEDULED_STAGES].includes(selectedStage) || !["", "quick", "deep"].includes(depth)
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("调度阶段、深度或处理上限无效。");
  if (repository && (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || selectedStage === "discover")) throw new Error("定向仓库参数无效，发现阶段不接受指定仓库。");
  if (scheduled && (repository || selectedStage !== "all" || depth || args.includes("--discovery-only"))) throw new Error("定时追赶模式不接受人工定向或阶段限制。");
  const order: readonly ScheduledStage[] = SCHEDULED_STAGES;
  const stages = order.filter((stage) => (selectedStage === "all" || selectedStage === stage)
    && !(args.includes("--discovery-only") && stage === "generate") && !(repository && stage === "discover"));
  const initial = await readStageSchedule();
  console.log(JSON.stringify({ mode: args.includes("--dry-run") ? "read-only" : scheduled ? "scheduled-catch-up" : "manual-force", stages: initial }, null, 2));
  if (args.includes("--dry-run")) return;
  const deadline = Date.now() + 1800_000;
  const outcomes: Array<Record<string, unknown>> = [];
  let failed = false;
  for (const stage of stages) {
    const state = (await readStageSchedule()).find((entry) => entry.stage === stage)!;
    if (state.busy || (scheduled && !state.due)) { outcomes.push({ stage, outcome: "skipped", reason: state.reason }); continue; }
    const runtime = stageRuntimeSeconds(stage, (deadline - Date.now()) / 1000);
    if (runtime === null) { outcomes.push({ stage, outcome: "deferred", reason: "本轮预算不足，保持到期状态供下一次唤醒追赶" }); continue; }
    const token = randomUUID();
    if (!await acquireStageLease(stage, token)) { outcomes.push({ stage, outcome: "skipped", reason: "其他调度已持有阶段租约" }); continue; }
    try {
      if (scheduled) {
        const latest = (await readStageSchedule()).find((entry) => entry.stage === stage)!;
        if (!evaluateStage(stage, { ...latest, leaseUntil: null }).due) { outcomes.push({ stage, outcome: "skipped", reason: "获得租约前阶段已被其他运行完成" }); continue; }
      }
      const childArgs = ["--env-file-if-exists=.env.local", "--import", "tsx", resolve("scripts/collect.ts"), "--stage", stage, "--limit", String(limit)];
      if (depth) childArgs.push("--depth", depth);
      if (repository) childArgs.push("--repository", repository);
      const child = spawn(process.execPath, childArgs, { stdio: "inherit", env: { ...process.env, COLLECTION_RUNTIME_SECONDS: String(runtime) } });
      const result = await superviseChild(child, { timeoutMs: runtime * 1000 + 15_000, renewLease: () => renewStageLease(stage, token) });
      const success = result.code === 0 && !result.timedOut && !result.leaseLost && !result.interrupted && !result.startFailed;
      outcomes.push({ stage, outcome: success ? "finished" : "failed", runtimeSeconds: runtime, ...result });
      if (!success) failed = true;
      if (result.interrupted) break;
    } finally {
      try { await releaseStageLease(stage, token); } catch { failed = true; console.error("调度阶段租约释放失败，将等待数据库租约自动过期。"); }
    }
  }
  const final = await readStageSchedule();
  console.log(JSON.stringify({ outcomes, stages: final }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### 到期追赶调度\n\n${outcomes.map((entry) => `- ${entry.stage}: ${entry.outcome}${entry.reason ? `（${entry.reason}）` : ""}`).join("\n")}\n\n${final.map((entry) => `- ${entry.stage}: 最近有效完成 ${entry.lastCompletedAt ?? "无"}；最近实际产出 ${entry.lastProducedAt ?? "无或不适用"}；${entry.reason}`).join("\n")}\n\n此调度依赖 GitHub 实际唤醒，不保证 cron 每次触发；没有产出不会被写成生成成功。\n`);
  }
  if (failed) process.exitCode = 1;
};

if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/scheduled-collect.ts")) {
  main().catch(() => { console.error("调度未完成，请检查数据库连接、阶段租约及运行日志；未输出连接或密钥。"); process.exitCode = 1; });
}
