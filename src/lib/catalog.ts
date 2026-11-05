import { isDatabaseConfigured, ITEM_JOINS, ITEM_SELECT, mapCatalogItem, queryRows } from "./db";
import type { CatalogQuery, CatalogResult, CollectionHealth, ProjectResult, SortKey, UpdateResult } from "./types";

const PAGE_SIZE = 20;
const ORDERS: Record<SortKey, string> = {
  recent: "e.published_at DESC, e.id DESC", stars: "r.stars DESC, e.id DESC",
  created: "r.created_at DESC, e.id DESC", pushed: "r.pushed_at DESC, e.id DESC",
  growth: "(latest.stars - baseline.stars) DESC NULLS LAST, e.id DESC",
};
const integer = (value: number | undefined, min: number, max: number, fallback: number): number =>
  value !== undefined && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;

const health = async (): Promise<{ health: CollectionHealth; coverage: NonNullable<CatalogResult["coverage"]> }> => {
  const [runs, counts, discoveryRuns] = await Promise.all([
    queryRows("SELECT * FROM collection_runs ORDER BY started_at DESC LIMIT 1"),
    queryRows(`SELECT count(*) FILTER (WHERE c.article IS NOT NULL) AS ready,
      count(*) FILTER (WHERE c.status='pending') AS pending,
      count(*) FILTER (WHERE c.status='processing') AS processing,
      count(*) FILTER (WHERE c.status IN ('failed','insufficient_sources')) AS failed_contents,
      count(*) FILTER (WHERE c.status IN ('failed','insufficient_sources') AND c.attempts < 3 AND c.error_kind IS DISTINCT FROM 'source') AS retryable,
      count(*) FILTER (WHERE c.status IN ('failed','insufficient_sources') AND (c.attempts >= 3 OR c.error_kind='source')) AS exhausted,
      (SELECT count(*) FROM repositories WHERE is_active AND synced_at < now()-interval '2 days') AS stale_repositories,
      (SELECT max(finished_at) FROM collection_runs WHERE status='completed') AS last_successful_at,
      (SELECT max(finished_at) FROM collection_runs WHERE status IN ('completed','partial')) AS last_updated_at
      FROM learning_contents c JOIN feed_events e ON e.id=c.event_id JOIN repositories r ON r.id=e.repository_id WHERE r.is_active`),
    queryRows(`SELECT discovery_scope,started_at,finished_at FROM collection_runs
      WHERE discovery_scope LIKE '%"queries"%' ORDER BY started_at DESC LIMIT 100`),
  ]);
  const row = runs[0]; const count = counts[0];
  let coverage: NonNullable<CatalogResult["coverage"]> = { scope: null, updatedAt: null };
  for (const run of discoveryRuns) {
    try {
      const parsed: unknown = JSON.parse(String(run.discovery_scope));
      if (parsed && typeof parsed === "object" && "queries" in parsed && Array.isArray(parsed.queries) && parsed.queries.length > 0) {
        coverage = { scope: String(run.discovery_scope), updatedAt: String(run.finished_at ?? run.started_at) };
        break;
      }
    } catch { /* Historical truncated scopes must not hide newer valid coverage or break the catalog. */ }
  }
  return { health: {
    lastRunStatus: row ? String(row.status) : null,
    lastRunAt: row ? String(row.finished_at ?? row.started_at) : null,
    discovered: Number(row?.discovered ?? 0), generated: Number(row?.generated ?? 0), failed: Number(row?.failed ?? 0),
    pending: Number(count.pending), processing: Number(count.processing), retryable: Number(count.retryable),
    exhausted: Number(count.exhausted), staleRepositories: Number(count.stale_repositories),
    ready: Number(count.ready), failedContents: Number(count.failed_contents),
    lastSuccessfulAt: count.last_successful_at ? String(count.last_successful_at) : null,
    stale: !count.last_updated_at || Date.now() - Date.parse(String(count.last_updated_at)) > 30 * 3600_000,
  }, coverage };
};

export const getCatalog = async (input: CatalogQuery = {}): Promise<CatalogResult> => {
  const configured = isDatabaseConfigured();
  const requestedPage = integer(input.page, 1, 1000000, 1);
  const empty: CatalogResult = { items: [], total: 0, page: 1, pageSize: PAGE_SIZE, languages: [], lastUpdatedAt: null, configured, error: false };
  if (!configured) return empty;
  const params: unknown[] = [];
  const conditions = ["r.is_active = true"];
  const add = (value: unknown): string => { params.push(value); return `$${params.length}`; };
  const q = input.q?.trim().slice(0, 200);
  if (q) {
    const pattern = add(`%${q.replace(/[\\%_]/g, "\\$&")}%`);
    conditions.push(`(r.full_name ILIKE ${pattern} OR r.description ILIKE ${pattern} OR c.article::text ILIKE ${pattern} OR e.release_body ILIKE ${pattern})`);
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
  if (input.contentState === "ready") conditions.push("c.article IS NOT NULL");
  if (input.contentState === "pending") conditions.push("c.status IN ('pending','processing')");
  if (input.contentState === "failed") conditions.push("c.status IN ('failed','insufficient_sources')");
  if (input.view !== "projects" && input.groupMinorReleases !== false) conditions.push(`(e.kind <> 'release' OR e.importance='major' OR NOT EXISTS (
    SELECT 1 FROM feed_events newer WHERE newer.repository_id=e.repository_id AND newer.kind='release' AND newer.importance='minor'
    AND date_trunc('week',newer.published_at AT TIME ZONE 'UTC')=date_trunc('week',e.published_at AT TIME ZONE 'UTC')
    AND (newer.published_at,newer.id) > (e.published_at,e.id)))`);
  const where = `WHERE ${conditions.join(" AND ")}`;
  const order = input.sort === "growth" && input.growthWindow === "1d" ? "(latest.stars-day_baseline.stars) DESC NULLS LAST,e.id DESC" : ORDERS[input.sort ?? "recent"] ?? ORDERS.recent;
  try {
    const [countRows, languageRows, updatedRows, state] = await Promise.all([
      queryRows(`SELECT count(*) AS total FROM feed_events e ${ITEM_JOINS} ${where}`, params),
      queryRows("SELECT DISTINCT language FROM repositories WHERE is_active = true AND language IS NOT NULL ORDER BY language"),
      queryRows("SELECT max(finished_at) AS updated FROM collection_runs WHERE status IN ('completed', 'partial')"), health(),
    ]);
    const total = Number(countRows[0]?.total ?? 0);
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / PAGE_SIZE)));
    const rows = await queryRows(`SELECT ${ITEM_SELECT} FROM feed_events e ${ITEM_JOINS} ${where} ORDER BY ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, PAGE_SIZE, (page - 1) * PAGE_SIZE]);
    const items = rows.map(mapCatalogItem);
    if (input.growthWindow === "1d") items.forEach((item,index) => { item.repository.starGrowth = item.repository.growth1d ?? null; item.repository.growthDays = rows[index].growth_1d_days === null ? null : Number(rows[index].growth_1d_days); });
    return { ...empty, items, total, page, languages: languageRows.map((row) => String(row.language)),
      lastUpdatedAt: updatedRows[0]?.updated ? String(updatedRows[0].updated) : null,
      health: state.health, coverage: state.coverage };
  } catch {
    console.error("Catalog query failed; verify database connectivity and schema.");
    return { ...empty, error: true };
  }
};

export const getProject = async (id: string): Promise<ProjectResult | null> => {
  if (!isDatabaseConfigured()) return null;
  try {
    const rows = await queryRows(`SELECT ${ITEM_SELECT} FROM feed_events e ${ITEM_JOINS} WHERE r.id=$1 ORDER BY (e.kind='discovery') DESC,e.published_at DESC,e.id DESC`, [id.slice(0, 100)]);
    if (!rows.length) return null;
    const items = rows.map(mapCatalogItem);
    const relatedRows = await queryRows(`SELECT ${ITEM_SELECT} FROM feed_events e ${ITEM_JOINS}
      WHERE r.is_active AND r.id<>$1 AND e.kind='discovery' AND
      (r.topics ?| $2::text[] OR ($3::text IS NOT NULL AND r.language=$3))
      ORDER BY (r.topics ?| $2::text[]) DESC,r.stars DESC LIMIT 5`, [id, items[0].repository.topics, items[0].repository.language]);
    return { repository: items[0].repository, item: items[0], updates: items.filter((item) => item.event.kind !== "discovery"), related: relatedRows.map(mapCatalogItem) };
  } catch { console.error("Project query failed; verify database connectivity and schema."); throw new Error("Project data is temporarily unavailable"); }
};

export const getUpdate = async (id: string): Promise<UpdateResult | null> => {
  if (!isDatabaseConfigured()) return null;
  try {
    const rows = await queryRows(`SELECT ${ITEM_SELECT} FROM feed_events e ${ITEM_JOINS} WHERE e.id=$1`, [id.slice(0, 250)]);
    if (!rows.length) return null;
    const item = mapCatalogItem(rows[0]); return { item, project: item.repository };
  } catch { console.error("Update query failed; verify database connectivity and schema."); throw new Error("Update data is temporarily unavailable"); }
};
