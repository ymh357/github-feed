import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { assertModel, generateLearning, ZeroGInfrastructureError } from "../src/lib/ai";
import { discoverRepositories, getReleases, getRepository, getCommit, getTree, getFile, githubJson, repositoryPath, GitHubError } from "../src/lib/github";
import { collectSources, InsufficientSourcesError, selectSections } from "../src/lib/sources";
import { store } from "../src/lib/store";
import { FORMAL_STAR_FLOOR, isFormalRepository } from "../src/lib/discovery-policy";
import type { ContentDepth, GitHubRepositoryInput, Repository, RunFinish } from "../src/lib/types";

const options = process.argv.slice(2);
const has = (name: string): boolean => options.includes(name);
const argument = (name: string, fallback: string): string => options.includes(name) ? options[options.indexOf(name) + 1] ?? "" : fallback;
const limit = Number(argument("--limit", "50"));
const stage = argument("--stage", "all");
const depth = argument("--depth", "") as ContentDepth | "";
const repositoryName = argument("--repository", "");
const runtime = Number(process.env.COLLECTION_RUNTIME_SECONDS ?? "1200");

const validateOptions = (): void => {
  const flags = new Set(["--dry-run", "--discovery-only"]);
  const values = new Set(["--limit", "--stage", "--depth", "--repository"]);
  for (let index = 0; index < options.length; index += 1) {
    if (values.has(options[index])) { if (!options[index + 1] || options[index + 1].startsWith("--")) throw new Error("收集参数缺少值。"); index += 1; }
    else if (!flags.has(options[index])) throw new Error("收集参数无效，请使用 --help。");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger(runtime) || runtime < 300 || runtime > 3600) throw new Error("收集 limit 应为 1..200，运行预算应为 300..3600 秒。");
  if (!["all", "discover", "sync", "generate"].includes(stage) || !["", "quick", "deep"].includes(depth)) throw new Error("收集 stage 或 depth 无效。");
  if (repositoryName) repositoryPath(repositoryName);
  if (repositoryName && stage === "discover") throw new Error("收集指定项目时请用 --stage sync、generate 或 all。");
};

const safeError = (error: unknown): string => {
  if (error instanceof GitHubError || error instanceof InsufficientSourcesError) return error.message;
  if (error instanceof Error && /^(?:GitHub|0G|模型|学习|缺少|仓库|版本|README|资料|收集|ZERO_G_MODEL)/.test(error.message)) return error.message.slice(0, 240);
  return "任务失败，请检查网络、服务端配置与数据库状态。";
};

const syncReleases = async (repository: Repository, isNew: boolean): Promise<void> => {
  const window = await getReleases(repository.fullName, repository.lastReleaseId, isNew ? 1 : 3);
  if (!isNew && !window.complete) throw new Error("GitHub 版本窗口超过 300 条，尚未覆盖基线；需补采。");
  const releases = window.releases;
  if (!releases.length) return;
  if (isNew) { await store.recordRelease(repository.id, releases[0], true); return; }
  const baseline = repository.lastReleaseId ? releases.findIndex((release) => release.id === repository.lastReleaseId) : -1;
  if (repository.lastReleaseId && baseline === -1) throw new Error("GitHub 上次正式版本基线已不可见；需人工核验。");
  const newer = baseline >= 0 ? releases.slice(0, baseline) : releases.filter((release) => Date.parse(release.publishedAt) > Date.parse(repository.discoveredAt));
  for (const release of newer.reverse()) await store.recordRelease(repository.id, release, false);
  if (!repository.lastReleaseId && !newer.length) await store.recordRelease(repository.id, releases[0], true);
};

const syncAnnouncement = async (repository: Repository): Promise<void> => {
  if (repository.lastReleaseId) return;
  const revision = await getCommit(repository.fullName, repository.defaultBranch);
  const tree = await getTree(repository.fullName, revision);
  const file = tree.find((entry) => entry.type === "blob" && /^(?:changelog|changes|news)(?:\.(?:md|rst|txt|markdown))?$/i.test(entry.path));
  if (!file) return;
  const commits = await githubJson(`${repositoryPath(repository.fullName)}/commits?${new URLSearchParams({ path: file.path, sha: revision, per_page: "1" })}`);
  if (!Array.isArray(commits) || !commits.length) return;
  const commit = commits[0] as { sha?: unknown; commit?: { message?: unknown; committer?: { date?: unknown } } };
  if (typeof commit.sha !== "string" || !/^[a-f0-9]{40}$/.test(commit.sha)) return;
  const body = await getFile(repository.fullName, file.path, commit.sha);
  const message = typeof commit.commit?.message === "string" ? commit.commit.message : "";
  const significant = /breaking|security|vulnerab|重大|安全|不兼容|^#{1,3}\s*(?:\[?v?\d+\.\d+|unreleased)/im.test(body.slice(0, 5000)) || /^(?:feat|release|security|breaking)/i.test(message);
  if (!significant) return;
  const publishedAt = commit.commit?.committer?.date;
  if (typeof publishedAt !== "string" || !Number.isFinite(Date.parse(publishedAt))) return;
  await store.recordAnnouncement(repository.id, { sha: commit.sha, title: `${repository.fullName} 官方变更文档更新`, path: file.path, body: selectSections(body, 15_000),
    url: `https://github.com/${repository.fullName}/blob/${commit.sha}/${encodeURIComponent(file.path)}`, publishedAt });
};

const main = async (): Promise<void> => {
  if (has("--help")) { console.log("用法：npm run collect -- [--stage all|discover|sync|generate] [--depth quick|deep] [--repository owner/name] [--limit 1..200] [--dry-run] [--discovery-only]\n--dry-run 仅预览发现，不写数据库或调用模型。定向恢复与刷新见 scripts/manage-content.ts。默认生成同时处理快速与深入队列，自动补充最多2个深入项目。"); return; }
  validateOptions();
  if (has("--dry-run")) {
    const discovery = await discoverRepositories(limit);
    console.log(JSON.stringify({ mode: "dry-run", scope: JSON.parse(discovery.scope), formalStarFloor: FORMAL_STAR_FLOOR, count: discovery.repositories.length,
      repositories: discovery.repositories.map(({ id, fullName, stars, discoveryChannels, admissionReason }) => ({ id, fullName, stars, discoveryChannels, admissionReason })),
      candidates: (discovery.candidates ?? []).map(({ id, fullName, stars, discoveryChannels, admissionReason }) => ({ id, fullName, stars, discoveryChannels, admissionReason })) }, null, 2)); return;
  }
  if (!process.env.DATABASE_URL) throw new Error("缺少 DATABASE_URL，未写入数据。");
  const generate = !has("--discovery-only") && ["all", "generate"].includes(stage);
  const model = process.env.ZERO_G_MODEL?.trim() ?? "";
  const deadline = Date.now() + runtime * 1000;
  const result: RunFinish = { status: "completed", discovered: 0, generated: 0, failed: 0 };
  const runId = await store.startRun({ discoveryScope: JSON.stringify({ stage, generatesContent: generate, depth: depth || "both", repository: repositoryName || null }) });
  let stopped = false;
  let infrastructureFailure = false;
  let discoveryDegraded = false;
  const handled = new Set<string>();
  const discoveryMetadataIds = new Set<string>();
  const recordFailure = (error: unknown, name: string): void => {
    result.failed += 1; console.error(`${name}：${safeError(error)}`);
    if (error instanceof ZeroGInfrastructureError || safeError(error) === "任务失败，请检查网络、服务端配置与数据库状态。") { stopped = true; infrastructureFailure = true; }
    if (error instanceof GitHubError && ([403, 429].includes(error.status) || error.status >= 500)) { stopped = true; infrastructureFailure = true; }
  };
  const sync = async (input: GitHubRepositoryInput): Promise<void> => {
    const { repository, isNew } = await store.upsertRepository(input);
    handled.add(repository.id);
    if (!isFormalRepository(input)) { discoveryMetadataIds.add(input.id); return; }
    await store.recordSnapshot(repository.id, repository.stars);
    discoveryMetadataIds.add(input.id);
    if (isNew) result.discovered += 1;
    await syncReleases(repository, isNew);
    await syncAnnouncement(repository);
  };
  try {
    if (generate) {
      if (!process.env.ZERO_G_API_KEY || !model) throw new Error("缺少 ZERO_G_API_KEY 或 ZERO_G_MODEL。");
      await assertModel(model);
    }
    if (["all", "discover"].includes(stage) && !repositoryName) {
      const discovery = await discoverRepositories(limit, new Date(), store);
      await store.setRunScope(runId, JSON.stringify({ ...JSON.parse(discovery.scope), stage, generatesContent: generate }));
      discoveryDegraded = discovery.degraded === true;
      const discoveryInputs = [...discovery.repositories, ...(discovery.candidates ?? [])];
      for (const input of discoveryInputs) {
        if (Date.now() > deadline - 90_000 || stopped) { stopped = true; break; }
        try { await sync(input); } catch (error) { recordFailure(error, input.fullName); }
      }
      // Discovery cursors acknowledge metadata persistence, independently of downstream release/document processing.
      if (discoveryInputs.every((input) => discoveryMetadataIds.has(input.id))) for (const update of discovery.cursorUpdates ?? []) await store.advanceDiscoveryCursor(update.key, update.page);
      result.message = `已检查 ${JSON.parse(discovery.scope).queries.length} 个渠道记录；正式项目 ${discovery.repositories.length} 个，早期候选 ${(discovery.candidates ?? []).length} 个，不是全 GitHub 扫描。${discoveryDegraded ? " Trending 渠道出现读取或核验失败，已降级并记录原因。" : ""}`;
      console.log(JSON.stringify({ discoveryScope: JSON.parse(discovery.scope) }));
    }
    if (!stopped && ["all", "sync"].includes(stage)) {
      const repositories = repositoryName ? [await getRepository(repositoryName)] : await store.getRepositoriesToSync(limit);
      for (const repository of repositories) {
        if (!repository || handled.has(repository.id)) continue;
        if (Date.now() > deadline - 90_000 || stopped) { stopped = true; break; }
        try {
          await store.recordSyncAttempt(repository.id);
          const input = await getRepository(repository.fullName, repository.id);
          if (input) await sync(input); else await store.retireRepository(repository.id);
        } catch (error) {
          if (error instanceof GitHubError && [404, 410].includes(error.status)) { await store.retireRepository(repository.id); continue; }
          recordFailure(error, repository.fullName);
        }
      }
    }
    if (!stopped) {
      const digests = await store.reconcileReleaseDigests();
      if (digests > 0) console.log(`已合并小版本变化，新增 ${digests} 个摘要任务。`);
    }
    if (generate && !stopped) {
      if (!repositoryName) await store.queueRefresh(Math.min(limit, 5));
      if (!depth && !repositoryName) for (const repository of await store.getDeepCandidates(2)) await store.resetContent(repository.fullName, { depth: "deep" });
      const events = await store.getPendingEvents(limit, { ...(depth ? { depth } : {}), ...(repositoryName ? { repository: repositoryName } : {}) });
      let next = 0;
      const worker = async (): Promise<void> => {
        while (next < events.length && !stopped) {
          if (Date.now() > deadline - 600_000) { stopped = true; break; }
          const item = events[next++];
          // Recheck admission immediately before paid work, including legacy and manually queued items.
          try {
            const current = await getRepository(item.repository.fullName, item.repository.id);
            if (!current) { await store.retireRepository(item.repository.id); continue; }
            await store.upsertRepository(current);
            if (!isFormalRepository(current)) continue;
            item.repository = { ...item.repository, ...current };
          } catch (error) {
            if (error instanceof GitHubError && [404, 410].includes(error.status)) { await store.retireRepository(item.repository.id); continue; }
            recordFailure(error, item.repository.fullName); continue;
          }
          if (!await store.claimEvent(item.event.id)) continue;
          const selectedDepth = depth || item.content?.requestedDepth || "quick";
          let content;
          try {
            console.log(`${item.repository.fullName}：开始${selectedDepth === "deep" ? "深入" : "快速"}解读`);
            const sources = await collectSources(item, selectedDepth);
            content = await generateLearning(item, sources, model, selectedDepth, () => !infrastructureFailure, deadline);
          } catch (error) {
            if (!process.env.CI && error instanceof Error && typeof error.cause === "string") {
              try {
                await mkdir("artifacts", { recursive: true, mode: 0o700 });
                const id = item.event.id.replace(/[^a-zA-Z0-9_-]/g, "_");
                let diagnostic = error.cause;
                for (const secret of [process.env.ZERO_G_API_KEY, process.env.DATABASE_URL]) if (secret) diagnostic = diagnostic.split(secret).join("[redacted]");
                diagnostic = diagnostic.replace(/\b(?:sk-|mk-|ghp_|gho_)[A-Za-z0-9_-]+/g, "[redacted credential]").replace(/postgres(?:ql)?:\/\/[^\s"<>]+/gi, "[redacted database URL]");
                await writeFile(`artifacts/generation-failure-${id}-${Date.now()}.json`, diagnostic, { mode: 0o600, flag: "wx" });
              } catch { /* Diagnostic persistence must not change the content failure state. */ }
            }
            await store.failContent(item.event.id, error instanceof InsufficientSourcesError ? "insufficient_sources" : "failed", safeError(error));
            recordFailure(error, item.repository.fullName); continue;
          }
          await store.saveContent(content);
          result.generated += 1;
          console.log(`${item.repository.fullName}：解读与事实复核完成`);
        }
      };
      await Promise.all([worker(), worker()]);
    }
    result.status = stopped || result.failed > 0 || discoveryDegraded ? "partial" : "completed";
    result.message = [result.message, stopped ? "达到有界运行预算或基础限流，队列保留供后续续跑。" : "本次阶段已结束。", result.failed ? `${result.failed} 项内容未完成，详情见失败状态。` : ""].filter(Boolean).join(" ");
    await store.finishRun(runId, result);
    console.log(JSON.stringify({ runId, ...result }));
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### 采集结果：${result.status}\n\n阶段：${stage}；新增 ${result.discovered}；生成 ${result.generated}；失败 ${result.failed}。\n\n${result.message}\n`);
    if (infrastructureFailure) process.exitCode = 1;
  } catch (error) {
    result.status = "failed"; result.message = safeError(error);
    try { await store.finishRun(runId, result); } catch { /* Preserve the original failure without logging secrets. */ }
    throw error;
  }
};

main().catch((error: unknown) => { console.error(safeError(error)); process.exitCode = 1; });
