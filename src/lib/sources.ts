import { getCommit, getFile, getTree } from "./github";
import type { CatalogItem, ContentSource } from "./types";

export class InsufficientSourcesError extends Error {}

export const collectSources = async (item: CatalogItem): Promise<ContentSource[]> => {
  const { repository, event } = item;
  const revision = await getCommit(repository.fullName, event.kind === "release" && event.releaseTag ? event.releaseTag : repository.defaultBranch);
  const tree = await getTree(repository.fullName, revision);
  const readme = tree.find((entry) => entry.type === "blob" && /^readme(?:\.(?:md|rst|txt|markdown))?$/i.test(entry.path));
  if (!readme) throw new InsufficientSourcesError("仓库根目录没有可核验的 README。");
  const fetchedAt = new Date().toISOString();
  const sources: ContentSource[] = [];
  let remaining = 44_000;
  const addFile = async (path: string, kind: "readme" | "source", maxLength: number): Promise<void> => {
    const text = await getFile(repository.fullName, path, revision);
    if (!text.trim()) return;
    const maximum = Math.min(maxLength, remaining);
    const clipped = text.length > maximum ? `${text.slice(0, maximum)}\n[资料在此截断，后续内容未读取]` : text;
    remaining -= clipped.length;
    sources.push({
      url: `https://github.com/${repository.fullName}/blob/${revision}/${path.split("/").map(encodeURIComponent).join("/")}`,
      title: path,
      kind,
      fetchedAt,
      revision,
      text: clipped,
    });
  };
  await addFile(readme.path, "readme", 24_000);
  if (!sources.length || (sources[0].text?.trim().length ?? 0) < 150) throw new InsufficientSourcesError("README 信息不足，无法生成可靠学习内容。");
  if (event.kind === "release" && event.releaseUrl) {
    if (!event.releaseBody?.trim()) throw new InsufficientSourcesError("版本缺少说明，无法可靠解释此次变化。");
    sources.push({ url: event.releaseUrl, title: event.title, kind: "release", fetchedAt, revision: event.releaseTag, text: event.releaseBody.slice(0, 10_000) });
  }
  const priority = /^(?:package\.json|pyproject\.toml|cargo\.toml|go\.mod|index\.[jt]s|main\.(?:py|go|rs)|app\.py)$/i;
  const candidatePaths = tree.filter((entry) => entry.type === "blob" && priority.test(entry.path) && (entry.size ?? Infinity) < 60_000).map((entry) => entry.path).slice(0, 2);
  const sourceFolder = tree.find((entry) => entry.type === "tree" && /^(?:src|lib|app)$/.test(entry.path));
  if (sourceFolder) {
    // Contents at the pinned commit avoids following arbitrary links from a README.
    const { githubJson, repositoryPath } = await import("./github");
    const entries = await githubJson(`${repositoryPath(repository.fullName)}/contents/${encodeURIComponent(sourceFolder.path)}?ref=${revision}`);
    if (Array.isArray(entries)) {
      const candidate = entries.find((entry: unknown) => {
        if (!entry || typeof entry !== "object") return false;
        const file = entry as Record<string, unknown>;
        return file.type === "file" && typeof file.name === "string" && /^(?:index|main|lib|app|__init__)\.(?:tsx?|jsx?|py|rs|go)$/.test(file.name) && typeof file.size === "number" && file.size < 60_000;
      }) as Record<string, unknown> | undefined;
      if (candidate && typeof candidate.path === "string") candidatePaths.push(candidate.path);
    }
  }
  for (const path of candidatePaths.slice(0, 3)) {
    if (remaining < 500) break;
    try { await addFile(path, "source", 6_000); } catch { /* Optional code files can be unavailable while the README remains useful. */ }
  }
  return sources;
};
