import type { GitHubRepositoryInput, ReleaseInput } from "./types";

type JsonRecord = Record<string, unknown>;

export class GitHubError extends Error {
  constructor(public readonly status: number, public readonly retryAfterSeconds: number | null = null) {
    super(status === 403 || status === 429 ? "GitHub 请求受到限流，请稍后续跑。" : `GitHub 请求失败（HTTP ${status}）。`);
  }
}

const record = (value: unknown): JsonRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("GitHub 返回的数据结构无效。");
  return value as JsonRecord;
};

const string = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value) throw new Error(`GitHub 字段 ${field} 缺失。`);
  return value;
};

const integer = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`GitHub 字段 ${field} 无效。`);
  return value;
};

export const repositoryPath = (fullName: string): string => {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) throw new Error("仓库路径应为 owner/name。");
  return `/repos/${fullName.split("/").map(encodeURIComponent).join("/")}`;
};

export const githubJson = async (path: string): Promise<unknown> => {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("GitHub API 路径无效。");
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`https://api.github.com${path}`, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "github-feed-learning",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(25_000),
        redirect: "error",
      });
    } catch {
      if (attempt === 2) throw new GitHubError(503);
      await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
      continue;
    }
    if (response.ok) {
      const reader = response.body?.getReader();
      if (!reader) throw new GitHubError(503);
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const part = await reader.read().catch(() => { throw new GitHubError(503); });
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 4_000_000) { await reader.cancel(); throw new Error("GitHub 响应超过安全大小限制。"); }
        chunks.push(part.value);
      }
      const body = Buffer.concat(chunks).toString("utf8");
      try { return JSON.parse(body) as unknown; } catch { throw new GitHubError(502); }
    }
    let waitSeconds: number | null = null;
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) {
      const parsed = Number(retryAfter);
      waitSeconds = Number.isFinite(parsed) ? parsed : Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000);
    } else if (response.headers.get("x-ratelimit-remaining") === "0") {
      waitSeconds = Math.max(1, Number(response.headers.get("x-ratelimit-reset")) - Math.floor(Date.now() / 1000));
    }
    if ((response.status === 429 || response.status >= 500 || (response.status === 403 && waitSeconds !== null)) && attempt < 2) {
      const delay = waitSeconds ?? (attempt + 1) * 2;
      if (!Number.isFinite(delay) || delay > 10) throw new GitHubError(response.status, waitSeconds);
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, delay) * 1000));
      continue;
    }
    throw new GitHubError(response.status, waitSeconds);
  }
  throw new Error("GitHub 请求未完成。");
};

export const parseRepository = (value: unknown): GitHubRepositoryInput | null => {
  const raw = record(value);
  if (raw.private === true || raw.fork === true || raw.archived === true || raw.disabled === true || raw.size === 0) return null;
  const createdAt = string(raw.created_at, "created_at");
  const pushedAt = string(raw.pushed_at, "pushed_at");
  if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(pushedAt))) throw new Error("GitHub 仓库时间无效。");
  const fullName = string(raw.full_name, "full_name");
  repositoryPath(fullName);
  return {
    id: String(integer(raw.id, "id")),
    fullName,
    description: typeof raw.description === "string" ? raw.description : "",
    url: `https://github.com/${fullName}`,
    homepage: typeof raw.homepage === "string" && /^https?:\/\//.test(raw.homepage) ? raw.homepage : null,
    language: typeof raw.language === "string" ? raw.language : null,
    topics: Array.isArray(raw.topics) ? raw.topics.filter((topic): topic is string => typeof topic === "string").slice(0, 30) : [],
    stars: integer(raw.stargazers_count, "stargazers_count"),
    forks: integer(raw.forks_count, "forks_count"),
    createdAt,
    pushedAt,
    defaultBranch: string(raw.default_branch, "default_branch"),
  };
};

export interface DiscoveryResult {
  repositories: GitHubRepositoryInput[];
  scope: string;
  incomplete: boolean;
  cursorUpdates?: Array<{ key: string; page: number }>;
}

export interface DiscoveryCursor {
  getDiscoveryCursor(key: string): Promise<number>;
  advanceDiscoveryCursor(key: string, page: number): Promise<void>;
}

export const discoverRepositories = async (limit: number, now: Date = new Date(), cursor?: DiscoveryCursor): Promise<DiscoveryResult> => {
  const day = Math.floor(now.getTime() / 86_400_000);
  const year = 2008 + (day % (now.getUTCFullYear() - 2008 + 1));
  const date = (days: number): string => new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  const common = "is:public fork:false archived:false";
  const partition = `created:${year}-01-01..${year}-12-31`;
  const channels = [
    { key: "new-low-star", query: `${common} stars:5..999 created:>=${date(30)}`, sort: "updated" },
    { key: "recent", query: `${common} stars:>=100 created:>=${date(90)}`, sort: "stars" },
    { key: "active-small", query: `${common} stars:20..999 pushed:>=${date(7)}`, sort: "updated" },
    { key: `established-${year}`, query: `${common} stars:>=1000 ${partition}`, sort: "stars" },
    { key: `active-established-${year}`, query: `${common} stars:>=1000 pushed:>=${date(7)} ${partition}`, sort: "updated" },
    { key: `archive-${year}`, query: `${common} stars:>=100 created:${year}-01-01..${year}-12-31`, sort: "stars" },
  ];
  const repositories = new Map<string, GitHubRepositoryInput>();
  const scopes: Array<Record<string, unknown>> = [];
  const cursorUpdates: Array<{ key: string; page: number }> = [];
  let incomplete = false;
  const offset = day % channels.length;
  const ordered = [...channels.slice(offset), ...channels.slice(0, offset)];
  for (const [index, channel] of ordered.entries()) {
    const quota = Math.floor(limit / channels.length) + (index < limit % channels.length ? 1 : 0);
    if (!quota) continue;
    const perPage = Math.min(100, quota);
    const cursorKey = `${channel.key}:size-${perPage}`;
    let page = Math.max(1, Math.min(Math.floor(1000 / perPage), cursor ? await cursor.getDiscoveryCursor(cursorKey) : 1));
    // Up to three pages per channel replenish duplicate candidates without an unbounded search.
    let accepted = 0;
    for (let attempt = 0; attempt < 3 && accepted < quota; attempt += 1) {
      const params = new URLSearchParams({ q: channel.query, sort: channel.sort, order: "desc", per_page: String(perPage), page: String(page) });
      const raw = record(await githubJson(`/search/repositories?${params}`));
      if (!Array.isArray(raw.items)) throw new Error("GitHub 搜索结果缺少项目列表。");
      const total = typeof raw.total_count === "number" ? raw.total_count : null;
      const bounded = raw.incomplete_results === true || (total !== null && total > raw.items.length);
      incomplete ||= bounded;
      scopes.push({ channel: channel.key, query: channel.query, sort: channel.sort, actualPage: page, perPage, received: raw.items.length, total, incomplete: bounded });
      for (const item of raw.items) {
        const repository = parseRepository(item);
        if (repository && !repositories.has(repository.id) && accepted < quota) { repositories.set(repository.id, repository); accepted += 1; }
      }
      const lastPage = total === null ? Math.floor(1000 / perPage) : Math.max(1, Math.min(Math.floor(1000 / perPage), Math.ceil(total / perPage)));
      page = raw.items.length < perPage || page >= lastPage ? 1 : page + 1;
      cursorUpdates.push({ key: cursorKey, page });
      if (!raw.items.length) break;
    }
  }
  return { repositories: [...repositories.values()], cursorUpdates, scope: JSON.stringify({ queries: scopes, policy: "bounded-multi-channel; stars and activity are discovery signals, not verified quality or growth" }), incomplete };
};

export const getRepository = async (fullName: string, repositoryId?: string): Promise<GitHubRepositoryInput | null> => {
  if (repositoryId && !/^\d+$/.test(repositoryId)) throw new Error("GitHub 仓库 ID 无效。");
  return parseRepository(await githubJson(repositoryId ? `/repositories/${repositoryId}` : repositoryPath(fullName)));
};

export interface ReleaseWindow { releases: ReleaseInput[]; complete: boolean; pages: number }

export const getReleases = async (fullName: string, baselineId: string | null = null, maxPages: number = 3): Promise<ReleaseWindow> => {
  const rows: JsonRecord[] = [];
  let complete = false;
  let pages = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const raw = await githubJson(`${repositoryPath(fullName)}/releases?per_page=100&page=${page}`);
    if (!Array.isArray(raw)) throw new Error("GitHub 版本列表无效。");
    const records = raw.map(record);
    rows.push(...records);
    pages += 1;
    complete = raw.length < 100 || (baselineId !== null && records.some((release) => String(release.id) === baselineId));
    if (complete) break;
  }
  const releases = rows.filter((release) => release.draft === false && release.prerelease === false && typeof release.published_at === "string")
    .map((release) => ({
      id: String(integer(release.id, "release.id")),
      tag: string(release.tag_name, "tag_name"),
      title: typeof release.name === "string" && release.name ? release.name : string(release.tag_name, "tag_name"),
      body: typeof release.body === "string" ? release.body.slice(0, 30_000) : "",
      url: `https://github.com/${fullName}/releases/tag/${encodeURIComponent(string(release.tag_name, "tag_name"))}`,
      publishedAt: string(release.published_at, "published_at"),
    })).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return { releases, complete, pages };
};

export const getCommit = async (fullName: string, ref: string): Promise<string> => {
  const raw = record(await githubJson(`${repositoryPath(fullName)}/commits/${encodeURIComponent(ref)}`));
  const sha = string(raw.sha, "sha");
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("GitHub commit 身份无效。");
  return sha;
};

export interface TreeEntry { path: string; type: string; size: number | null }

export const getTree = async (fullName: string, sha: string, recursive = false): Promise<TreeEntry[]> => {
  const raw = record(await githubJson(`${repositoryPath(fullName)}/git/trees/${encodeURIComponent(sha)}${recursive ? "?recursive=1" : ""}`));
  if (!Array.isArray(raw.tree)) throw new Error("GitHub 目录数据无效。");
  return raw.tree.slice(0, recursive ? 2000 : 500).map(record).filter((entry) => typeof entry.path === "string" && typeof entry.type === "string")
    .map((entry) => ({ path: entry.path as string, type: entry.type as string, size: typeof entry.size === "number" ? entry.size : null }));
};

export const getFile = async (fullName: string, path: string, sha: string): Promise<string> => {
  if (path.includes("..") || path.startsWith("/") || path.length > 500) throw new Error("源码路径无效。");
  const raw = record(await githubJson(`${repositoryPath(fullName)}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(sha)}`));
  if (raw.type !== "file" || typeof raw.size !== "number" || raw.size > 2_000_000) throw new Error("资料不是可读取的文本文件，或超过 2 MB 下载上限。");
  const body = raw.encoding === "base64" ? raw : typeof raw.sha === "string" && /^[a-f0-9]{40}$/.test(raw.sha)
    ? record(await githubJson(`${repositoryPath(fullName)}/git/blobs/${raw.sha}`)) : raw;
  if (body.encoding !== "base64" || typeof body.content !== "string") throw new Error("资料没有可核验的文本内容。");
  const bytes = Buffer.from(body.content, "base64");
  if (bytes.length > 2_000_000 || bytes.includes(0)) throw new Error("资料包含二进制内容或超过 2 MB 下载上限。");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new Error("资料不是有效 UTF-8 文本。"); }
};
