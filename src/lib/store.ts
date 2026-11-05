import { randomUUID } from "node:crypto";
import { ITEM_JOINS, ITEM_SELECT, mapCatalogItem, mapRepository, queryRows } from "./db";
import type { StoreContract } from "./types";

const safeMessage = (message: string): string => message
  .replace(/(?:postgres(?:ql)?:\/\/|https?:\/\/)[^\s]+/gi, "[redacted URL]")
  .replace(/\b(?:sk-|mk-|ghp_|gho_)[A-Za-z0-9_-]+/g, "[redacted credential]")
  .slice(0, 500);

const boundedLimit = (limit: number): number => Number.isFinite(limit) ? Math.min(1000, Math.max(1, Math.floor(limit))) : 20;
const ownedLeases = new Map<string, string>();

export const store: StoreContract = {
  async startRun(input) {
    const id = randomUUID();
    await queryRows("INSERT INTO collection_runs (id, discovery_scope) VALUES ($1, $2)", [id, input.discoveryScope.slice(0, 2000)]);
    return id;
  },

  async finishRun(id, result) {
    await queryRows(`UPDATE collection_runs SET status = $2, discovered = $3,
      generated = $4, failed = $5, message = $6, finished_at = now() WHERE id = $1`,
    [id, result.status, result.discovered, result.generated, result.failed, result.message ? safeMessage(result.message) : null]);
  },

  async upsertRepository(input) {
    const eventId = `discovery_${input.id}`;
    const rows = await queryRows(`WITH saved AS (
      INSERT INTO repositories (id, full_name, description, url, homepage, language, topics, stars, forks,
        created_at, pushed_at, default_branch, last_sync_attempt_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,now())
      ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, description = EXCLUDED.description,
        url = EXCLUDED.url, homepage = EXCLUDED.homepage, language = EXCLUDED.language, topics = EXCLUDED.topics,
        stars = EXCLUDED.stars, forks = EXCLUDED.forks, pushed_at = EXCLUDED.pushed_at,
        default_branch = EXCLUDED.default_branch, synced_at = now(), last_sync_attempt_at = now(), is_active = true
      RETURNING *, (xmax = 0) AS is_new
    ), event AS (
      INSERT INTO feed_events (id, repository_id, kind, title, published_at)
      SELECT $13, id, 'discovery', full_name, discovered_at FROM saved
      ON CONFLICT DO NOTHING RETURNING id
    ), content AS (
      INSERT INTO learning_contents (id, event_id)
      SELECT 'content_' || id, id FROM event ON CONFLICT DO NOTHING RETURNING id
    ) SELECT * FROM saved`, [input.id, input.fullName, input.description, input.url, input.homepage,
      input.language, JSON.stringify(input.topics), input.stars, input.forks, input.createdAt,
      input.pushedAt, input.defaultBranch, eventId]);
    return { repository: mapRepository(rows[0]), isNew: Boolean(rows[0].is_new) };
  },

  async recordSnapshot(repositoryId, stars) {
    await queryRows(`INSERT INTO repository_snapshots (repository_id, stars) VALUES ($1, $2)
      ON CONFLICT (repository_id, sample_day) DO NOTHING`, [repositoryId, stars]);
  },

  async recordRelease(repositoryId, release, baseline) {
    const params = [repositoryId, release.id, release.publishedAt, release.tag, release.title,
      release.body.slice(0, 100000), release.url, `release_${repositoryId}_${release.id}`];
    if (baseline) {
      await queryRows(`UPDATE repositories SET last_release_id = $2, last_release_published_at = $3
        WHERE id = $1 AND last_release_id IS NULL`, params.slice(0, 3));
      return;
    }
    await queryRows(`WITH updated AS (
      UPDATE repositories SET last_release_id = $2, last_release_published_at = $3
      WHERE id = $1 AND (last_release_published_at IS NULL OR last_release_published_at <= $3::timestamptz)
      RETURNING id
    ), event AS (
      INSERT INTO feed_events (id, repository_id, kind, title, published_at, release_id, release_tag, release_body, release_url)
      VALUES ($8, $1, 'release', $5, $3, $2, $4, $6, $7)
      ON CONFLICT DO NOTHING RETURNING id
    ) INSERT INTO learning_contents (id, event_id)
      SELECT 'content_' || id, id FROM event ON CONFLICT DO NOTHING`, params);
  },

  async getRepositoriesToSync(limit) {
    const rows = await queryRows(`SELECT * FROM repositories WHERE is_active = true
      ORDER BY COALESCE(last_sync_attempt_at, synced_at) ASC, id ASC LIMIT $1`, [boundedLimit(limit)]);
    return rows.map(mapRepository);
  },

  async recordSyncAttempt(repositoryId) {
    await queryRows("UPDATE repositories SET last_sync_attempt_at = now() WHERE id = $1", [repositoryId]);
  },

  async retireRepository(repositoryId) {
    await queryRows("UPDATE repositories SET is_active = false, last_sync_attempt_at = now() WHERE id = $1", [repositoryId]);
  },

  async getPendingEvents(limit) {
    await queryRows(`UPDATE learning_contents SET status = 'failed', lease_until = NULL, lease_token = NULL,
      error_summary = 'Processing interrupted; retry limit reached', updated_at = now()
      WHERE status = 'processing' AND lease_until < now() AND attempts >= 3`);
    const rows = await queryRows(`SELECT ${ITEM_SELECT} FROM feed_events e ${ITEM_JOINS}
      WHERE r.is_active = true AND c.attempts < 3 AND (c.status IN ('pending', 'failed', 'insufficient_sources')
        OR (c.status = 'processing' AND c.lease_until < now()))
      ORDER BY c.attempts ASC, e.observed_at ASC, e.id ASC LIMIT $1`, [boundedLimit(limit)]);
    return rows.map(mapCatalogItem);
  },

  async claimEvent(eventId) {
    const token = randomUUID();
    const rows = await queryRows(`UPDATE learning_contents SET status = 'processing', attempts = attempts + 1,
      lease_until = now() + interval '20 minutes', lease_token = $2, updated_at = now(), error_summary = NULL
      WHERE event_id = $1 AND attempts < 3 AND (status IN ('pending', 'failed', 'insufficient_sources')
        OR (status = 'processing' AND lease_until < now()))
        AND EXISTS (SELECT 1 FROM feed_events e JOIN repositories r ON r.id = e.repository_id
          WHERE e.id = $1 AND r.is_active = true) RETURNING id`, [eventId, token]);
    if (rows.length === 1) ownedLeases.set(eventId, token);
    return rows.length === 1;
  },

  async saveContent(input) {
    const token = ownedLeases.get(input.eventId);
    if (!token) throw new Error("Content was not claimed by this worker");
    const sources = input.sources.map(({ url, title, kind, fetchedAt, revision }) => ({ url, title, kind, fetchedAt, revision }));
    const rows = await queryRows(`WITH saved AS (
      UPDATE learning_contents SET status = 'ready', article = $2::jsonb, model = $3,
        generated_at = now(), input_hash = $4, prompt_version = $5, input_tokens = $6,
        output_tokens = $7, lease_until = NULL, lease_token = NULL, error_summary = NULL, updated_at = now()
      WHERE event_id = $1 AND status = 'processing' AND lease_until >= now() AND lease_token = $9 RETURNING id
    ), sources AS (
      INSERT INTO content_sources (content_id, url, title, kind, fetched_at, revision)
      SELECT saved.id, source.url, source.title, source.kind, source."fetchedAt", source.revision
      FROM saved CROSS JOIN jsonb_to_recordset($8::jsonb)
        AS source(url text, title text, kind text, "fetchedAt" timestamptz, revision text)
      ON CONFLICT (content_id, url) DO NOTHING RETURNING id
    ) SELECT id FROM saved`, [input.eventId, JSON.stringify(input.article), input.model,
      input.inputHash, input.promptVersion, input.inputTokens, input.outputTokens, JSON.stringify(sources), token]);
    ownedLeases.delete(input.eventId);
    if (rows.length !== 1) throw new Error("Content lease expired or content already completed");
  },

  async failContent(eventId, status, reason) {
    const token = ownedLeases.get(eventId);
    if (!token) return;
    await queryRows(`UPDATE learning_contents SET status = $2, error_summary = $3,
      lease_until = NULL, lease_token = NULL, updated_at = now()
      WHERE event_id = $1 AND status = 'processing' AND lease_until >= now() AND lease_token = $4`,
    [eventId, status, safeMessage(reason), token]);
    ownedLeases.delete(eventId);
  },
};
