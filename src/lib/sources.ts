import { getCommit, getFile, getTree, GitHubError } from "./github";
import type { CatalogItem, ContentSource, ContentDepth } from "./types";

export class InsufficientSourcesError extends Error {}

export const selectSections = (text: string, maximum: number): string => {
  if (text.length <= maximum) return text;
  const starts = [...text.matchAll(/^#{1,4}\s+.+$/gm)].map((match) => match.index ?? 0);
  const sections = [0, ...starts.filter((index) => index > 0)].map((start, index, positions) => ({ start, end: positions[index + 1] ?? text.length }));
  const selected: Array<{ start: number; end: number }> = [];
  let budget = Math.max(0, maximum - 1200);
  const include = (start: number, end: number, allowance: number): void => {
    if (budget < 200 || selected.some((part) => start >= part.start && start < part.end)) return;
    const length = Math.min(end - start, allowance, budget);
    if (length < 100) return;
    selected.push({ start, end: start + length });
    budget -= length;
  };
  include(0, text.length, Math.floor(maximum / 5));
  const priority = /install|quick.?start|usage|architecture|design|how.?it.?works|getting.?started|breaking|security|配置|架构|安装|使用|原理/i;
  for (const part of sections.filter((part) => priority.test(text.slice(part.start, part.start + 160))).slice(0, 4)) include(part.start, part.end, Math.floor(maximum / 12));
  for (const fraction of [0.25, 0.5, 0.75, 0.9]) {
    const target = Math.floor(text.length * fraction);
    const section = sections.find((part) => part.start <= target && part.end > target);
    include(section && section.end - section.start < maximum ? section.start : target, section?.end ?? text.length, Math.floor(maximum / 8));
  }
  const excerpt = selected.sort((a, b) => a.start - b.start).map((part) => `[原文字符 ${part.start + 1}–${part.end}]\n${text.slice(part.start, part.end)}`).join("\n\n[中间未选入部分未提供给模型]\n\n");
  return `[读取范围：原文 ${text.length} 字符，按简介、相关章节及分布位置选取；并非全文解读，未选入部分不可作为结论依据]\n${excerpt}`.slice(0, maximum);
};

export const collectSources = async (item: CatalogItem, depth: ContentDepth = "quick"): Promise<ContentSource[]> => {
  const { repository, event } = item;
  const revision = await getCommit(repository.fullName, event.kind !== "discovery" && event.releaseTag ? event.releaseTag : repository.defaultBranch);
  const root = await getTree(repository.fullName, revision);
  let tree = root;
  try { tree = [...root, ...await getTree(repository.fullName, revision, true)].filter((entry, index, entries) => entries.findIndex((other) => other.path === entry.path) === index); } catch (error) {
    if (error instanceof GitHubError && ([403, 429].includes(error.status) || error.status >= 500)) throw error;
  }
  const readmePattern = /(?:^|\/)(?:readme(?:[._-](?:en|zh(?:[._-](?:cn|tw))?|english|chinese))?|index)\.(?:md|rst|txt|markdown|mdx)$/i;
  const readme = root.find((entry) => entry.type === "blob" && /^readme(?:\.(?:md|rst|txt|markdown))?$/i.test(entry.path))
    ?? tree.find((entry) => entry.type === "blob" && readmePattern.test(entry.path) && entry.path.split("/").length <= 3);
  if (!readme) throw new InsufficientSourcesError("README 或文档入口缺失，无法建立可靠项目介绍。");
  const fetchedAt = new Date().toISOString();
  const sources: ContentSource[] = [];
  let remaining = depth === "deep" ? 58_000 : 36_000;
  const addFile = async (path: string, kind: "readme" | "source" | "docs", maximum: number): Promise<void> => {
    const text = await getFile(repository.fullName, path, revision);
    if (!text.trim()) return;
    const excerpt = selectSections(text, Math.min(maximum, remaining));
    remaining -= excerpt.length;
    sources.push({ url: `https://github.com/${repository.fullName}/blob/${revision}/${path.split("/").map(encodeURIComponent).join("/")}`, title: path, kind, fetchedAt, revision, readingRange: text.length <= excerpt.length ? `全文 ${text.length} 字符` : `原文 ${text.length} 字符；按简介、章节及分布位置节选及范围标记共 ${excerpt.length} 字符，未提供部分不作依据`, text: excerpt });
  };
  await addFile(readme.path, "readme", depth === "deep" ? 24_000 : 18_000);
  if (!sources.length || (sources[0].text?.trim().length ?? 0) < 150) throw new InsufficientSourcesError("README 信息不足，无法生成可靠学习内容。");
  if (event.kind !== "discovery" && event.releaseUrl) {
    if (!event.releaseBody?.trim()) throw new InsufficientSourcesError("版本或公告缺少原始说明，无法可靠解释此次变化。");
    const text = selectSections(event.releaseBody, Math.min(8_000, remaining));
    remaining -= text.length;
    sources.push({ url: event.releaseUrl, title: event.title, kind: "release", fetchedAt, revision, text });
  }
  const excluded = /(?:^|\/)(?:node_modules|vendor|dist|build|\.git|test|tests|fixtures|examples)(?:\/|$)|(?:lock|\.min)\./i;
  const code = tree.filter((entry) => entry.type === "blob" && !excluded.test(entry.path) && (entry.size ?? Infinity) <= 100_000 && /\.(?:tsx?|jsx?|py|go|rs|java|kt|swift|c|cpp|h)$|(?:^|\/)(?:package\.json|pyproject\.toml|cargo\.toml|go\.mod)$/i.test(entry.path));
  const rank = (path: string): number => (/architecture|design|getting.started|quickstart|usage|install/i.test(path) ? 0 : /(?:^|\/)(?:main|index|app|lib|__init__|server|router|agent)\./i.test(path) ? 1 : /package\.json|pyproject|cargo\.toml|go\.mod/i.test(path) ? 2 : 3) + path.split("/").length / 10;
  const docs = tree.filter((entry) => entry.type === "blob" && entry.path !== readme.path && !excluded.test(entry.path) && /^(?:docs?|documentation)\/.*\.(?:md|mdx|rst|txt)$/i.test(entry.path));
  const candidates = [...docs.sort((a, b) => rank(a.path) - rank(b.path)).slice(0, depth === "deep" ? 3 : 1).map((entry) => ({ ...entry, kind: "docs" as const })),
    ...code.sort((a, b) => rank(a.path) - rank(b.path)).slice(0, depth === "deep" ? 6 : 3).map((entry) => ({ ...entry, kind: "source" as const }))];
  for (const entry of candidates) {
    if (remaining < 600) break;
    try { await addFile(entry.path, entry.kind, depth === "deep" ? 6_000 : 4_000); } catch (error) {
      if (error instanceof GitHubError && ([403, 429].includes(error.status) || error.status >= 500)) throw error;
    }
  }
  return sources;
};
