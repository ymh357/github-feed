import type { GitHubRepositoryInput } from "./types";

export const FORMAL_STAR_FLOOR = 1000;
export const isFormalRepository = (repository: { stars: number }): boolean => repository.stars >= FORMAL_STAR_FLOOR;
export const admissionReason = (repository: { stars: number }): string => isFormalRepository(repository)
  ? `累计 Star ${repository.stars.toLocaleString("en-US")}，达到正式收录门槛 ${FORMAL_STAR_FLOOR.toLocaleString("en-US")}；热度不等于质量保证。`
  : `累计 Star ${repository.stars.toLocaleString("en-US")}，低于正式门槛 ${FORMAL_STAR_FLOOR.toLocaleString("en-US")}，仅保留候选，不生成解读。`;

export const withDiscoveryChannel = (repository: GitHubRepositoryInput, channel: string): GitHubRepositoryInput => ({
  ...repository,
  discoveryChannels: [...new Set([...(repository.discoveryChannels ?? []), channel])],
  admissionReason: admissionReason(repository),
});

export const getTrendingNames = async (period: "daily" | "weekly"): Promise<{ names: string[]; url: string; bytes: number; observedAt: string }> => {
  const url = `https://github.com/trending?since=${period}`;
  // HTML receives no API authorization header; every extracted repository is checked through the API separately.
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "text/html", "User-Agent": "github-feed-learning" }, redirect: "error", signal: AbortSignal.timeout(25_000) });
  } catch { throw new Error("GitHub Trending 页面网络请求失败或超时。"); }
  if (!response.ok) throw new Error(`GitHub Trending 页面请求失败（HTTP ${response.status}）。`);
  if (!response.headers.get("content-type")?.includes("text/html")) throw new Error("GitHub Trending 页面没有返回 HTML。");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("GitHub Trending 页面为空。");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > 2_000_000) { await reader.cancel(); throw new Error("GitHub Trending 页面超过 2 MB 读取上限。"); }
    chunks.push(part.value);
  }
  const html = Buffer.concat(chunks).toString("utf8");
  const names = new Set<string>();
  for (const article of html.matchAll(/<article\b[^>]*class=["'][^"']*\bBox-row\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi)) {
    const heading = article[1].match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1];
    const path = heading?.match(/<a\b[^>]*href=["']\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)["']/i)?.[1];
    if (path) names.add(path);
  }
  if (!names.size) throw new Error("GitHub Trending 页面未解析到项目，可能已改版；已降级至全站热门渠道。");
  return { names: [...names].slice(0, 30), url, bytes, observedAt: new Date().toISOString() };
};
