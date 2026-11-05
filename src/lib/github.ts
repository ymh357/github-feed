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
      if (attempt === 2) throw new Error("GitHub 网络请求失败或超时。");
      await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
      continue;
    }
    if (response.ok) {
      const body = await response.text();
      if (body.length > 4_000_000) throw new Error("GitHub 响应超过安全大小限制。");
      return JSON.parse(body) as unknown;
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
}

export const discoverRepositories = async (limit: number, now: Date = new Date()): Promise<DiscoveryResult> => {
  const day = Math.floor(now.getTime() / 86_400_000);
  const yearCount = now.getUTCFullYear() - 2008 + 1;
  const year = 2008 + (day % yearCount);
  const bands = ["1000..4999", "5000..19999", "20000..99999", ">=100000"];
  const band = bands[Math.floor(day / yearCount) % bands.length];
  const recent = new Date(now.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);
  const page = 1 + (Math.floor(day / (yearCount * bands.length)) % 10);
  const queries = [
    `is:public fork:false archived:false stars:>=100 created:>=${recent}`,
    "is:public fork:false archived:false stars:>=1000",
    `is:public fork:false archived:false stars:${band} created:${year}-01-01..${year}-12-31`,
  ];
  const perPage = Math.min(100, Math.max(1, Math.ceil(limit / queries.length)));
  const repositories = new Map<string, GitHubRepositoryInput>();
  const buckets: GitHubRepositoryInput[][] = [];
  const scopes: Array<{ query: string; requestedPage: number; actualPage: number; received: number; total: number | null; incomplete: boolean }> = [];
  let incomplete = false;
  for (const [index, query] of queries.entries()) {
    const selectedPage = index === 0 ? 1 + (day % 10) : index === 1 ? 1 + (Math.floor(day / 10) % 10) : page;
    const params = new URLSearchParams({ q: query, sort: "stars", order: "desc", per_page: String(perPage), page: String(selectedPage) });
    let raw = record(await githubJson(`/search/repositories?${params}`));
    if (!Array.isArray(raw.items)) throw new Error("GitHub 搜索结果缺少项目列表。");
    if (raw.items.length === 0 && selectedPage !== 1) {
      params.set("page", "1");
      raw = record(await githubJson(`/search/repositories?${params}`));
    }
    if (!Array.isArray(raw.items)) throw new Error("GitHub 搜索结果缺少项目列表。");
    const bounded = raw.incomplete_results === true || (typeof raw.total_count === "number" && raw.total_count > raw.items.length);
    incomplete ||= bounded;
    scopes.push({ query, requestedPage: selectedPage, actualPage: Number(params.get("page")), received: raw.items.length, total: typeof raw.total_count === "number" ? raw.total_count : null, incomplete: bounded });
    const bucket: GitHubRepositoryInput[] = [];
    for (const item of raw.items) {
      const repository = parseRepository(item);
      if (repository) bucket.push(repository);
    }
    buckets.push(bucket);
  }
  for (let index = 0; index < perPage && repositories.size < limit; index += 1) {
    for (const bucket of buckets) {
      const repository = bucket[index];
      if (repository && repositories.size < limit) repositories.set(repository.id, repository);
    }
  }
  return { repositories: [...repositories.values()], scope: JSON.stringify({ queries: scopes, perPage }), incomplete };
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

export const getTree = async (fullName: string, sha: string): Promise<TreeEntry[]> => {
  const raw = record(await githubJson(`${repositoryPath(fullName)}/git/trees/${encodeURIComponent(sha)}`));
  if (!Array.isArray(raw.tree)) throw new Error("GitHub 目录数据无效。");
  return raw.tree.slice(0, 200).map(record).filter((entry) => typeof entry.path === "string" && typeof entry.type === "string")
    .map((entry) => ({ path: entry.path as string, type: entry.type as string, size: typeof entry.size === "number" ? entry.size : null }));
};

export const getFile = async (fullName: string, path: string, sha: string): Promise<string> => {
  if (path.includes("..") || path.startsWith("/") || path.length > 500) throw new Error("源码路径无效。");
  const raw = record(await githubJson(`${repositoryPath(fullName)}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(sha)}`));
  if (raw.type !== "file" || raw.encoding !== "base64" || typeof raw.content !== "string" || typeof raw.size !== "number" || raw.size > 100_000) throw new Error("资料不是可读取的小型文本文件。");
  const text = Buffer.from(raw.content, "base64").toString("utf8");
  if (text.includes("\u0000")) throw new Error("资料包含二进制内容。");
  return text;
};
