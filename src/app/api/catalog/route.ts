import { getCatalog } from "@/lib/catalog";
import type { CatalogQuery, SortKey } from "@/lib/types";

export const dynamic = "force-dynamic";

const sorts = new Set<SortKey>(["recent", "stars", "created", "pushed", "growth"]);
const validIds = (input: unknown): input is string[] =>
  Array.isArray(input) && input.length <= 20000 && input.every((id: unknown) => typeof id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(id));

export const POST = async (request: Request): Promise<Response> => {
  if (Number(request.headers.get("content-length")) > 1_000_000) {
    return Response.json({ error: "筛选数据过大，请减少选择后重试。" }, { status: 413 });
  }
  try {
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ error: "筛选内容为空。" }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1_000_000) {
        await reader.cancel();
        return Response.json({ error: "筛选数据过大。" }, { status: 413 });
      }
      chunks.push(chunk.value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return Response.json({ error: "筛选格式无效。" }, { status: 400 });
    const input = raw as Record<string, unknown>;
    if ((input.ids !== undefined && !validIds(input.ids)) || (input.readEventIds !== undefined && !validIds(input.readEventIds))) {
      return Response.json({ error: "筛选标识无效或过多。请导出个人记录后分批筛选。" }, { status: 400 });
    }
    const query: CatalogQuery = {
      q: typeof input.q === "string" ? input.q.slice(0, 200) : undefined,
      contentState: input.contentState === "ready" || input.contentState === "pending" || input.contentState === "failed" ? input.contentState : undefined,
      growthWindow: input.growthWindow === "1d" ? "1d" : "7d",
      groupMinorReleases: input.groupMinorReleases !== false,
      sort: sorts.has(input.sort as SortKey) ? input.sort as SortKey : "recent",
      view: input.view === "projects" ? "projects" : "feed",
      language: typeof input.language === "string" ? input.language.slice(0, 80) : undefined,
      minStars: typeof input.minStars === "number" && Number.isFinite(input.minStars) ? Math.max(0, Math.min(input.minStars, 100000000)) : undefined,
      days: typeof input.days === "number" && Number.isFinite(input.days) && input.days > 0 ? Math.min(Math.floor(input.days), 36500) : undefined,
      page: typeof input.page === "number" && Number.isFinite(input.page) ? Math.max(1, Math.min(Math.floor(input.page), 1000000)) : 1,
      ids: input.ids as string[] | undefined,
      readEventIds: input.readEventIds as string[] | undefined,
      readState: input.readState === "read" || input.readState === "unread" ? input.readState : "all",
    };
    const result = await getCatalog(query);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "无法读取筛选条件。" }, { status: 400 });
  }
};
