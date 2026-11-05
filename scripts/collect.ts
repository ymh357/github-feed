import { assertModel, generateLearning } from "../src/lib/ai";
import { discoverRepositories, getReleases, getRepository, GitHubError } from "../src/lib/github";
import { collectSources, InsufficientSourcesError } from "../src/lib/sources";
import { store } from "../src/lib/store";
import type { GitHubRepositoryInput, Repository, RunFinish } from "../src/lib/types";

const options = process.argv.slice(2);
const has = (name: string): boolean => options.includes(name);
const limitIndex = options.indexOf("--limit");
const limit = limitIndex >= 0 ? Number(options[limitIndex + 1]) : 50;
const runtime = Number(process.env.COLLECTION_RUNTIME_SECONDS ?? "1200");
const validateOptions = (): void => {
  const allowedOptions = new Set(["--dry-run", "--discovery-only", "--limit"]);
  for (let index = 0; index < options.length; index += 1) {
    if (!allowedOptions.has(options[index])) throw new Error("收集参数无效；支持 --dry-run、--discovery-only、--limit 1..200。");
    if (options[index] === "--limit") index += 1;
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger(runtime) || runtime < 300 || runtime > 3600) throw new Error("收集 limit 应为 1..200，运行预算应为 300..3600 秒。");
};

const safeError = (error: unknown): string => {
  if (error instanceof GitHubError || error instanceof InsufficientSourcesError) return error.message;
  if (error instanceof Error && /^(?:GitHub|0G|模型|学习|缺少|仓库|版本|README|资料|收集|ZERO_G_MODEL)/.test(error.message)) return error.message.slice(0, 240);
  return "任务失败，请检查网络、服务端配置与数据库状态。";
};

const syncReleases = async (repository: Repository, isNew: boolean): Promise<void> => {
  const window = await getReleases(repository.fullName, repository.lastReleaseId, isNew ? 1 : 3);
  const releases = window.releases;
  if (!isNew && !window.complete) throw new Error("GitHub 版本窗口超过 300 条，尚未覆盖基线；本次未发布不完整更新，需补采。");
  if (!releases.length) return;
  if (isNew) {
    await store.recordRelease(repository.id, releases[0], true);
    return;
  }
  const baselineIndex = repository.lastReleaseId ? releases.findIndex((release) => release.id === repository.lastReleaseId) : -1;
  if (repository.lastReleaseId && baselineIndex === -1) {
    throw new Error("GitHub 上次正式版本基线已不可见；需人工核验，未跳过缺失版本。");
  }
  const newer = baselineIndex >= 0 ? releases.slice(0, baselineIndex) : releases.filter((release) => Date.parse(release.publishedAt) > Date.parse(repository.discoveredAt));
  for (const release of newer.reverse()) await store.recordRelease(repository.id, release, false);
  if (!repository.lastReleaseId && !newer.length) await store.recordRelease(repository.id, releases[0], true);
};

const main = async (): Promise<void> => {
  if (has("--help")) {
    console.log("用法：npm run collect -- [--dry-run] [--discovery-only] [--limit 1..200]\n--dry-run：只读取 GitHub 候选，不写数据库、不调用模型。\n--discovery-only：同步项目与版本，不调用模型。\n默认处理上限 50，COLLECTION_RUNTIME_SECONDS 默认 1200 秒。");
    return;
  }
  validateOptions();
  const deadline = Date.now() + runtime * 1000;
  const discovery = await discoverRepositories(limit);
  if (has("--dry-run")) {
    console.log(JSON.stringify({ mode: "dry-run", scope: JSON.parse(discovery.scope), coverage: discovery.incomplete ? "bounded" : "complete-for-query", count: discovery.repositories.length, repositories: discovery.repositories.map(({ id, fullName, stars, createdAt }) => ({ id, fullName, stars, createdAt })) }, null, 2));
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("缺少 DATABASE_URL，未写入数据。");
  const discoveryOnly = has("--discovery-only");
  const model = process.env.ZERO_G_MODEL?.trim() ?? "";
  // Validate model availability before creating chargeable generation jobs.
  if (!discoveryOnly) {
    if (!process.env.ZERO_G_API_KEY || !model) throw new Error("缺少 ZERO_G_API_KEY 或 ZERO_G_MODEL；可用 --discovery-only 仅同步项目。");
    await assertModel(model);
  }
  const runId = await store.startRun({ discoveryScope: discovery.scope });
  const result: RunFinish = { status: "completed", discovered: 0, generated: 0, failed: 0 };
  let stopped = false;
  const sync = async (input: GitHubRepositoryInput): Promise<void> => {
    const { repository, isNew } = await store.upsertRepository(input);
    await store.recordSnapshot(repository.id, repository.stars);
    if (isNew) result.discovered += 1;
    await syncReleases(repository, isNew);
  };
  try {
    const handled = new Set<string>();
    for (const input of discovery.repositories) {
      if (Date.now() > deadline - 90_000) { stopped = true; break; }
      try { await sync(input); handled.add(input.id); } catch (error) {
        result.failed += 1;
        console.error(`${input.fullName}：${safeError(error)}`);
        if (error instanceof GitHubError && [403, 429].includes(error.status)) { stopped = true; break; }
      }
    }
    if (!stopped) {
      const repositories = await store.getRepositoriesToSync(limit);
      for (const repository of repositories) {
        if (Date.now() > deadline - 90_000) { stopped = true; break; }
        if (handled.has(repository.id)) continue;
        try {
          await store.recordSyncAttempt(repository.id);
          const input = await getRepository(repository.fullName, repository.id);
          if (input) await sync(input);
          else await store.retireRepository(repository.id);
        } catch (error) {
          if (error instanceof GitHubError && [404, 410].includes(error.status)) {
            await store.retireRepository(repository.id);
            continue;
          }
          result.failed += 1;
          console.error(`${repository.fullName}：${safeError(error)}`);
          if (error instanceof GitHubError && [403, 429].includes(error.status)) { stopped = true; break; }
        }
      }
    }
    if (!discoveryOnly && !stopped) {
      const events = await store.getPendingEvents(limit);
      for (const item of events) {
        if (Date.now() > deadline - 300_000) { stopped = true; break; }
        if (!await store.claimEvent(item.event.id)) continue;
        try {
          const sources = await collectSources(item);
          const content = await generateLearning(item, sources, model);
          await store.saveContent(content);
          result.generated += 1;
        } catch (error) {
          result.failed += 1;
          const message = safeError(error);
          await store.failContent(item.event.id, error instanceof InsufficientSourcesError ? "insufficient_sources" : "failed", message);
          console.error(`${item.repository.fullName}：${message}`);
          if (error instanceof GitHubError && [403, 429].includes(error.status)) { stopped = true; break; }
        }
      }
    }
    result.status = stopped || result.failed > 0 ? "partial" : "completed";
    result.message = stopped ? "达到运行预算或限流，未处理任务将在后续运行继续。" : discovery.incomplete ? "已完成有界发现范围；不是全 GitHub 完整扫描。" : "本次范围处理完成。";
    await store.finishRun(runId, result);
    console.log(JSON.stringify({ runId, ...result }));
    if (result.failed > 0) process.exitCode = 1;
  } catch (error) {
    result.status = "failed";
    result.message = safeError(error);
    try { await store.finishRun(runId, result); } catch { /* Preserve the original failure without exposing database diagnostics. */ }
    throw error;
  }
};

main().catch((error: unknown) => { console.error(safeError(error)); process.exitCode = 1; });
