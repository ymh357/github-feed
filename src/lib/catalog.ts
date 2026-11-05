import { isDatabaseConfigured, ITEM_JOINS, ITEM_SELECT, mapCatalogItem, queryRows } from "./db";
import type { CatalogQuery, CatalogResult, ProjectResult, SortKey, UpdateResult } from "./types";

const PAGE_SIZE = 20;
const ORDERS: Record<SortKey, string> = {
  recent: "e.published_at DESC, e.id DESC",
  stars: "r.stars DESC, e.id DESC",
  created: "r.created_at DESC, e.id DESC",
  pushed: "r.pushed_at DESC, e.id DESC",
  growth: "(latest.stars - baseline.stars) DESC NULLS LAST, e.id DESC",
};

const integer = (value: number | undefined, min: number, max: number, fallback: number): number =>
  value !== undefined && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;

export const getCatalog = async (input: CatalogQuery = {}): Promise<CatalogResult> => {
  const configured = isDatabaseConfigured();
  const requestedPage = integer(input.page, 1, 1000000, 1);
  const empty: CatalogResult = {
    items: [], total: 0, page: 1, pageSize: PAGE_SIZE, languages: [], lastUpdatedAt: null, configured, error: false,
  };
  if (!configured) return empty;
  const params: unknown[] = [];
  const conditions: string[] = ["r.is_active = true"];
  const add = (value: unknown): string => { params.push(value); return `$${params.length}`; };
  const q = input.q?.trim().slice(0, 200);
  if (q) {
    const pattern = add(`%${q.replace(/[\\%_]/g, "\\$&")}%`);
    conditions.push(`(r.full_name ILIKE ${pattern} OR r.description ILIKE ${pattern} OR c.article->>'summary' ILIKE ${pattern})`);
  }
  if (input.language?.trim()) conditions.push(`r.language = ${add(input.language.trim().slice(0, 80))}`);
  if (input.minStars !== undefined) conditions.push(`r.stars >= ${add(integer(input.minStars, 0, 1000000000, 0))}`);
  if (input.days !== undefined && input.days > 0) conditions.push(`e.published_at >= now() - (${add(integer(input.days, 1, 36500, 30))}::integer * interval '1 day')`);
  if (input.ids !== undefined) conditions.push(`r.id = ANY(${add(input.ids.slice(0, 20000))}::text[])`);
  if (input.readState === "read" || input.readState === "unread") {
    const ids = add((input.readEventIds ?? []).slice(0, 20000));
    conditions.push(input.readState === "read" ? `e.id = ANY(${ids}::text[])` : `NOT (e.id = ANY(${ids}::text[]))`);
  }
  if (input.view === "projects") conditions.push("e.kind = 'discovery'");
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const order = ORDERS[input.sort ?? "recent"] ?? ORDERS.recent;
  try {
    const [countRows, languageRows, updatedRows] = await Promise.all([
      queryRows(`SELECT count(*) AS total FROM feed_events e ${ITEM_JOINS} ${where}`, params),
      queryRows("SELECT DISTINCT language FROM repositories WHERE is_active = true AND language IS NOT NULL ORDER BY language"),
      queryRows("SELECT max(finished_at) AS updated FROM collection_runs WHERE status IN ('completed', 'partial')"),
    ]);
    const total = Number(countRows[0]?.total ?? 0);
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / PAGE_SIZE)));
    const rows = await queryRows(`SELECT ${ITEM_SELECT} FROM feed_events e ${ITEM_JOINS}
      ${where} ORDER BY ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, PAGE_SIZE, (page - 1) * PAGE_SIZE]);
    const updated = updatedRows[0]?.updated;
    return {
      ...empty, items: rows.map(mapCatalogItem), total, page,
      languages: languageRows.map((row) => String(row.language)),
      lastUpdatedAt: updated instanceof Date ? updated.toISOString() : updated ? String(updated) : null,
    };
  } catch {
    console.error("Catalog query failed; verify database connectivity and schema.");
    return { ...empty, error: true };
  }
};

export const getProject = async (id: string): Promise<ProjectResult | null> => {
  if (!isDatabaseConfigured()) return null;
  try {
    const rows = await queryRows(`SELECT ${ITEM_SELECT} FROM feed_events e ${ITEM_JOINS}
      WHERE r.id = $1 ORDER BY (e.kind = 'discovery') DESC, e.published_at DESC, e.id DESC`, [id.slice(0, 100)]);
    if (!rows.length) return null;
    const items = rows.map(mapCatalogItem);
    return { repository: items[0].repository, item: items[0], updates: items.filter((item) => item.event.kind === "release") };
  } catch {
    console.error("Project query failed; verify database connectivity and schema.");
    throw new Error("Project data is temporarily unavailable");
  }
};

export const getUpdate = async (id: string): Promise<UpdateResult | null> => {
  if (!isDatabaseConfigured()) return null;
  try {
    const rows = await queryRows(`SELECT ${ITEM_SELECT} FROM feed_events e ${ITEM_JOINS} WHERE e.id = $1`, [id.slice(0, 250)]);
    if (!rows.length) return null;
    const item = mapCatalogItem(rows[0]);
    return { item, project: item.repository };
  } catch {
    console.error("Update query failed; verify database connectivity and schema.");
    throw new Error("Update data is temporarily unavailable");
  }
};
