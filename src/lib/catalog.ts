import { isDatabaseConfigured, LEARNING_EVENT_FILTER, ITEM_JOINS, ITEM_SELECT, mapCatalogItem, queryRows, type DbRow } from "./db";
import type { CatalogItem, CatalogQuery, CatalogResult, CollectionHealth, ProjectResult, SortKey, UpdateResult } from "./types";

const publicCatalogItem = (row: DbRow): CatalogItem => {
  const item = mapCatalogItem(row);
  if (item.event.releaseEntries) item.event.releaseEntries = item.event.releaseEntries.map((entry) => ({
    id: entry.id, tag: entry.tag, title: entry.title, url: entry.url, publishedAt: entry.publishedAt, body: "",
  }));
  return item;
};

const PAGE_SIZE = 20;
const ORDERS: Record<SortKey, string> = {
  recent: "e.published_at DESC, e.id DESC", stars: "r.stars DESC, e.id DESC",
  created: "r.created_at DESC, e.id DESC", pushed: "r.pushed_at DESC, e.id DESC",
  growth: "(latest.stars - baseline.stars) DESC NULLS LAST, e.id DESC",
};
const integer = (value: number | undefined, min: number, max: number, fallback: number): number =>
  value !== undefined && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;

const publicRunMessage = (value: unknown): string | null => typeof value === "string" ? value
  .replace(/(?:postgres(?:ql)?:\/\/|https?:\/\/)[^\s]+/gi, "[已隐藏连接地址]")
  .replace(/\b(?:sk-|mk-|ghp_|gho_)[A-Za-z0-9_-]+/g, "[已隐藏凭据]")
  .slice(0, 500) : null;

const health = async (): Promise<{ health: CollectionHealth; coverage: NonNullable<CatalogResult["coverage"]> }> => {
  const [runs, counts, discoveryRuns, generationRuns] = await Promise.all([
    queryRows("SELECT * FROM collection_runs ORDER BY started_at DESC LIMIT 1"),
    queryRows(`SELECT count(*) FILTER (WHERE c.article IS NOT NULL) AS ready,
      count(*) FILTER (WHERE c.status='pending') AS pending,
      min(c.updated_at) FILTER (WHERE c.status='pending') AS oldest_pending_at,
      count(*) FILTER (WHERE c.status='pending' AND c.article IS NULL AND e.kind='discovery') AS pending_projects,
      count(*) FILTER (WHERE c.status='pending' AND c.article IS NULL AND e.kind<>'discovery') AS pending_updates,
      count(*) FILTER (WHERE c.status='pending' AND c.article IS NOT NULL) AS pending_refresh,
      count(*) FILTER (WHERE c.status='pending' AND c.article IS NOT NULL AND c.requested_depth='deep') AS pending_deep,
      max(c.generated_at) AS last_generated_at,
      (SELECT max(finished_at) FROM collection_runs WHERE status IN ('completed','partial') AND generated>0) AS last_successful_generation_at,
      count(*) FILTER (WHERE c.status='processing') AS processing,
      count(*) FILTER (WHERE c.status IN ('failed','insufficient_sources')) AS failed_contents,
      count(*) FILTER (WHERE c.status IN ('failed','insufficient_sources') AND c.attempts < 3 AND c.error_kind IS DISTINCT FROM 'source') AS retryable,
      count(*) FILTER (WHERE c.status IN ('failed','insufficient_sources') AND (c.attempts >= 3 OR c.error_kind='source')) AS exhausted,
      (SELECT count(*) FROM repositories WHERE is_active AND admission_status='eligible' AND stars>=1000 AND synced_at < now()-interval '2 days') AS stale_repositories,
      (SELECT max(finished_at) FROM collection_runs WHERE status='completed') AS last_successful_at,
      (SELECT max(finished_at) FROM collection_runs WHERE status IN ('completed','partial')) AS last_updated_at
      FROM learning_contents c JOIN feed_events e ON e.id=c.event_id JOIN repositories r ON r.id=e.repository_id WHERE r.is_active AND r.admission_status='eligible' AND r.stars>=1000 AND ${LEARNING_EVENT_FILTER}`),
    queryRows(`SELECT discovery_scope,started_at,finished_at FROM collection_runs
      WHERE discovery_scope LIKE '%"queries"%' ORDER BY started_at DESC LIMIT 100`),
    queryRows(`SELECT status,message,started_at,finished_at,generated,failed,discovery_scope FROM collection_runs
      WHERE discovery_scope LIKE '%"generate"%' OR discovery_scope LIKE '%"all"%'
        OR discovery_scope LIKE '%"generatesContent":true%' OR discovery_scope LIKE '%"generatesContent": true%' OR generated>0
      ORDER BY started_at DESC LIMIT 100`),
  ]);
  const row = runs[0]; const count = counts[0];
  const generation = generationRuns.find((run) => {
    try {
      const scope: unknown = JSON.parse(String(run.discovery_scope));
      if (!scope || typeof scope !== "object") return Number(run.generated) > 0;
      const stage = "stage" in scope ? scope.stage : null;
      const produces = "generatesContent" in scope ? scope.generatesContent : undefined;
      if (produces === false) return false;
      return produces === true || stage === "generate" || stage === "all" || Number(run.generated) > 0;
    } catch { return Number(run.generated) > 0; }
  });
  const lastGeneratedAt = count.last_generated_at ? String(count.last_generated_at) : null;
  const generationReferenceAt = lastGeneratedAt ?? (count.oldest_pending_at ? String(count.oldest_pending_at) : null);
  const generationStale = Number(count.pending) > 0 && generationReferenceAt !== null && Date.now() - Date.parse(generationReferenceAt) > 30 * 3600_000;
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
    generationStatus: generation ? String(generation.status) : null,
    generationMessage: publicRunMessage(generation?.message),
    generationAt: generation ? String(generation.finished_at ?? generation.started_at) : null,
    generationGenerated: Number(generation?.generated ?? 0), generationFailed: Number(generation?.failed ?? 0),
    lastSuccessfulGenerationAt: count.last_successful_generation_at ? String(count.last_successful_generation_at) : null,
    lastGeneratedAt, generationStale,
    pendingProjects: Number(count.pending_projects), pendingUpdates: Number(count.pending_updates),
    pendingRefresh: Number(count.pending_refresh), pendingDeep: Number(count.pending_deep),
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
  const conditions = ["r.is_active = true", "r.admission_status = 'eligible'", "r.stars >= 1000", LEARNING_EVENT_FILTER];
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
  const where = `WHERE ${conditions.join(" AND ")}`;
  const order = input.sort === "growth" && input.growthWindow === "1d" ? "(latest.stars-day_baseline.stars) DESC NULLS LAST,e.id DESC" : ORDERS[input.sort ?? "recent"] ?? ORDERS.recent;
  try {
    const [countRows, languageRows, updatedRows, state] = await Promise.all([
      queryRows(`SELECT count(*) AS total FROM feed_events e ${ITEM_JOINS} ${where}`, params),
      queryRows("SELECT DISTINCT language FROM repositories WHERE is_active = true AND admission_status='eligible' AND stars>=1000 AND language IS NOT NULL ORDER BY language"),
      queryRows("SELECT max(finished_at) AS updated FROM collection_runs WHERE status IN ('completed', 'partial')"), health(),
    ]);
    const total = Number(countRows[0]?.total ?? 0);
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / PAGE_SIZE)));
    const rows = await queryRows(`SELECT ${ITEM_SELECT} FROM feed_events e ${ITEM_JOINS} ${where} ORDER BY ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, PAGE_SIZE, (page - 1) * PAGE_SIZE]);
    const items = rows.map(publicCatalogItem);
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
    const items = rows.map(publicCatalogItem);
    const relatedRows = await queryRows(`SELECT ${ITEM_SELECT} FROM feed_events e ${ITEM_JOINS}
      WHERE r.is_active AND r.admission_status='eligible' AND r.stars>=1000 AND r.id<>$1 AND e.kind='discovery' AND
      (r.topics ?| $2::text[] OR ($3::text IS NOT NULL AND r.language=$3))
      ORDER BY (r.topics ?| $2::text[]) DESC,r.stars DESC LIMIT 5`, [id, items[0].repository.topics, items[0].repository.language]);
    return { repository: items[0].repository, item: items[0], updates: items.filter((item) => item.event.kind !== "discovery" && !item.event.digestEventId), related: relatedRows.map(publicCatalogItem) };
  } catch { console.error("Project query failed; verify database connectivity and schema."); throw new Error("Project data is temporarily unavailable"); }
};

export const getUpdate = async (id: string): Promise<UpdateResult | null> => {
  if (!isDatabaseConfigured()) return null;
  try {
    const rows = await queryRows(`SELECT ${ITEM_SELECT} FROM feed_events e ${ITEM_JOINS} WHERE e.id=COALESCE((SELECT digest_event_id FROM feed_events WHERE id=$1),$1)`, [id.slice(0, 250)]);
    if (!rows.length) return null;
    const item = publicCatalogItem(rows[0]); return { item, project: item.repository };
  } catch { console.error("Update query failed; verify database connectivity and schema."); throw new Error("Update data is temporarily unavailable"); }
};
