import { randomUUID } from "node:crypto";
import { getDb, ITEM_JOINS, ITEM_SELECT, mapCatalogItem, mapRepository, queryRows } from "./db";
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
    await queryRows("INSERT INTO collection_runs (id, discovery_scope) VALUES ($1, $2)", [id, input.discoveryScope.slice(0, 20000)]);
    return id;
  },

  async setRunScope(id, scope) {
    const parsed: unknown = JSON.parse(scope);
    const serialized = JSON.stringify(parsed);
    if (serialized.length > 100000) throw new Error("Discovery scope exceeds safe storage limit");
    await queryRows("UPDATE collection_runs SET discovery_scope=$2 WHERE id=$1", [id,serialized]);
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
      release.body.slice(0, 100000), release.url, `release_${repositoryId}_${release.id}`,
      /(?:breaking|security|重大|安全)/i.test(release.title + " " + release.body) || /^v?\d+\.0\.0(?:$|[-+])/i.test(release.tag) ? "major" : "minor"];
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
      INSERT INTO feed_events (id, repository_id, kind, title, published_at, release_id, release_tag, release_body, release_url, importance)
      VALUES ($8, $1, 'release', $5, $3, $2, $4, $6, $7, $9)
      ON CONFLICT DO NOTHING RETURNING id
    ) INSERT INTO learning_contents (id, event_id)
      SELECT 'content_' || id, id FROM event ON CONFLICT DO NOTHING`, params);
  },

  async getRepositoriesToSync(limit) {
    const rows = await queryRows(`SELECT * FROM repositories WHERE is_active = true
      ORDER BY COALESCE(last_sync_attempt_at,synced_at) + CASE WHEN pushed_at > now()-interval '14 days' THEN interval '0 hours' ELSE interval '12 hours' END ASC, id ASC LIMIT $1`, [boundedLimit(limit)]);
    return rows.map(mapRepository);
  },

  async recordSyncAttempt(repositoryId) {
    await queryRows("UPDATE repositories SET last_sync_attempt_at = now() WHERE id = $1", [repositoryId]);
  },

  async retireRepository(repositoryId) {
    await queryRows("UPDATE repositories SET is_active = false, last_sync_attempt_at = now() WHERE id = $1", [repositoryId]);
  },

  async getPendingEvents(limit, options = {}) {
    await queryRows(`UPDATE learning_contents SET status='failed',lease_until=NULL,lease_token=NULL,
      error_kind='transient',error_summary='上次处理意外中断，已达到重试上限。',updated_at=now()
      WHERE status='processing' AND lease_until<now() AND attempts>=3`);
    const rows = await queryRows(`SELECT ${ITEM_SELECT} FROM feed_events e ${ITEM_JOINS}
      WHERE r.is_active AND c.attempts<3 AND c.error_kind IS DISTINCT FROM 'source'
      AND (c.next_retry_at IS NULL OR c.next_retry_at<=now())
      AND (c.status IN ('pending','failed','insufficient_sources') OR (c.status='processing' AND c.lease_until<now()))
      AND ($2::text IS NULL OR c.requested_depth=$2) AND ($3::text IS NULL OR lower(r.full_name)=lower($3))
      ORDER BY row_number() OVER (PARTITION BY (c.attempts>0) ORDER BY c.updated_at,e.id),
        (c.attempts>0) DESC,e.id LIMIT $1`, [boundedLimit(limit), options.depth ?? null, options.repository ?? null]);
    return rows.map(mapCatalogItem);
  },

  async claimEvent(eventId) {
    const token = randomUUID();
    const rows = await queryRows(`UPDATE learning_contents SET status = 'processing', attempts = attempts + 1,
      lease_until = now() + interval '20 minutes', lease_token = $2, updated_at = now(), error_summary = NULL
      WHERE event_id = $1 AND attempts < 3 AND error_kind IS DISTINCT FROM 'source'
        AND (next_retry_at IS NULL OR next_retry_at<=now()) AND (status IN ('pending', 'failed', 'insufficient_sources')
        OR (status = 'processing' AND lease_until < now()))
        AND EXISTS (SELECT 1 FROM feed_events e JOIN repositories r ON r.id = e.repository_id
          WHERE e.id = $1 AND r.is_active = true) RETURNING id`, [eventId, token]);
    if (rows.length === 1) ownedLeases.set(eventId, token);
    return rows.length === 1;
  },

  async saveContent(input) {
    const token = ownedLeases.get(input.eventId);
    if (!token) throw new Error("Content was not claimed by this worker");
    const sources = input.sources.map(({ url, title, kind, fetchedAt, revision, readingRange }) => ({ url, title, kind, fetchedAt, revision, readingRange }));
    const db = getDb();
    const results = await db.transaction([
      db.query(`INSERT INTO content_versions(id,content_id,article,sources,model,generated_at,depth,input_hash)
        SELECT $3,c.id,c.article,COALESCE((SELECT jsonb_agg(jsonb_build_object('url',s.url,'title',s.title,'kind',s.kind,'fetchedAt',s.fetched_at,'revision',s.revision,'readingRange',s.reading_range) ORDER BY s.id) FROM content_sources s WHERE s.content_id=c.id),'[]'::jsonb),
        c.model,c.generated_at,c.depth,c.input_hash FROM learning_contents c
        WHERE c.event_id=$1 AND c.lease_token=$2 AND c.article IS NOT NULL AND c.generated_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM content_versions v WHERE v.content_id=c.id AND v.article=c.article
          AND v.input_hash IS NOT DISTINCT FROM c.input_hash AND v.depth=c.depth AND v.model IS NOT DISTINCT FROM c.model)
        ON CONFLICT DO NOTHING`, [input.eventId,token,randomUUID()]),
      db.query(`UPDATE learning_contents SET status='ready',article=$2::jsonb,model=$3,generated_at=now(),
        input_hash=$4,prompt_version=$5,input_tokens=$6,output_tokens=$7,depth=$9,requested_depth=$9,
        lease_until=NULL,lease_token=NULL,error_summary=NULL,error_kind=NULL,next_retry_at=NULL,refresh_requested_at=NULL,updated_at=now()
        WHERE event_id=$1 AND status='processing' AND lease_until>=now() AND lease_token=$8 RETURNING id`,
        [input.eventId,JSON.stringify(input.article),input.model,input.inputHash,input.promptVersion,input.inputTokens,input.outputTokens,token,input.depth ?? "quick"]),
      db.query(`DELETE FROM content_sources WHERE content_id IN (SELECT id FROM learning_contents WHERE event_id=$1 AND status='ready' AND input_hash=$2)`, [input.eventId,input.inputHash]),
      db.query(`WITH sources AS (
        INSERT INTO content_sources(content_id,url,title,kind,fetched_at,revision,reading_range)
        SELECT c.id,s.url,s.title,s.kind,s."fetchedAt",s.revision,s."readingRange" FROM learning_contents c
        CROSS JOIN jsonb_to_recordset($3::jsonb) AS s(url text,title text,kind text,"fetchedAt" timestamptz,revision text,"readingRange" text)
        WHERE c.event_id=$1 AND c.status='ready' AND c.input_hash=$2 ON CONFLICT DO NOTHING RETURNING id
      ) INSERT INTO content_versions(id,content_id,article,sources,model,generated_at,depth,input_hash)
        SELECT $4,c.id,c.article,$3::jsonb,c.model,c.generated_at,c.depth,c.input_hash FROM learning_contents c
        WHERE c.event_id=$1 AND c.status='ready' AND c.input_hash=$2
        AND NOT EXISTS (SELECT 1 FROM content_versions v WHERE v.content_id=c.id AND v.article=c.article
          AND v.input_hash IS NOT DISTINCT FROM c.input_hash AND v.depth=c.depth AND v.model IS NOT DISTINCT FROM c.model)
        ON CONFLICT DO NOTHING`,
        [input.eventId,input.inputHash,JSON.stringify(sources),randomUUID()]),
    ]);
    ownedLeases.delete(input.eventId);
    if (results[1].length !== 1) throw new Error("Content lease expired or content already completed");
  },

  async getDiscoveryCursor(key) {
    const rows = await queryRows("SELECT page FROM discovery_cursors WHERE key=$1", [key.slice(0,500)]);
    return rows.length ? Number(rows[0].page) : 1;
  },

  async advanceDiscoveryCursor(key, page) {
    if (!Number.isSafeInteger(page) || page<1 || page>1000) throw new Error("Discovery cursor page is invalid");
    await queryRows("INSERT INTO discovery_cursors(key,page) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET page=EXCLUDED.page,updated_at=now()", [key.slice(0,500),page]);
  },

  async queueRefresh(limit) {
    const rows = await queryRows(`UPDATE learning_contents c SET status='pending',attempts=0,requested_depth=c.depth,
      error_kind=NULL,error_summary=NULL,next_retry_at=NULL,refresh_requested_at=now(),updated_at=now()
      WHERE c.id IN (SELECT c2.id FROM learning_contents c2 JOIN feed_events e ON e.id=c2.event_id
        JOIN repositories r ON r.id=e.repository_id WHERE r.is_active AND e.kind='discovery' AND c2.status='ready'
        AND (c2.generated_at<now()-interval '30 days' OR (r.pushed_at>c2.generated_at AND c2.generated_at<now()-interval '7 days'))
        ORDER BY c2.generated_at LIMIT $1) RETURNING id`, [boundedLimit(limit)]);
    return rows.length;
  },

  async getDeepCandidates(limit) {
    const rows = await queryRows(`SELECT r.* FROM repositories r JOIN feed_events e ON e.repository_id=r.id AND e.kind='discovery'
      JOIN learning_contents c ON c.event_id=e.id WHERE r.is_active AND c.status='ready' AND c.depth='quick'
      AND NOT EXISTS(SELECT 1 FROM content_versions v WHERE v.content_id=c.id AND v.depth='deep')
      ORDER BY c.generated_at,r.id LIMIT $1`, [boundedLimit(limit)]);
    return rows.map(mapRepository);
  },

  async resetContent(repositoryName, options = {}) {
    const rows = await queryRows(`UPDATE learning_contents c SET status='pending',attempts=0,
      requested_depth=COALESCE($2::text,c.depth),error_kind=NULL,error_summary=NULL,next_retry_at=NULL,
      refresh_requested_at=now(),updated_at=now() WHERE c.event_id IN (SELECT e.id FROM feed_events e
        JOIN repositories r ON r.id=e.repository_id WHERE lower(r.full_name)=lower($1)
        AND ($3::boolean OR e.kind='discovery'))
      AND (c.status<>'processing' OR c.lease_until<now())
      AND (NOT $3::boolean OR c.status IN ('failed','insufficient_sources')) RETURNING id`,
      [repositoryName,options.depth ?? null,options.retryOnly ?? false]);
    return rows.length;
  },

  async recordAnnouncement(repositoryId, announcement) {
    const rows = await queryRows(`WITH previous AS (SELECT last_announcement_sha FROM repositories WHERE id=$1 FOR UPDATE),
      updated AS (UPDATE repositories SET last_announcement_sha=$2 WHERE id=$1 RETURNING id),
      event AS (INSERT INTO feed_events(id,repository_id,kind,title,published_at,release_tag,release_body,release_url,importance)
        SELECT $3,$1,'announcement',$4,$5,$2,$6,$7,'major' FROM updated,previous
        WHERE previous.last_announcement_sha IS NOT NULL AND previous.last_announcement_sha<>$2
        ON CONFLICT DO NOTHING RETURNING id)
      INSERT INTO learning_contents(id,event_id) SELECT 'content_'||id,id FROM event RETURNING id`,
      [repositoryId,announcement.sha,`announcement_${repositoryId}_${announcement.sha}`,announcement.title,
        announcement.publishedAt,announcement.body.slice(0,100000),announcement.url]);
    void rows;
  },

  async failContent(eventId, status, reason) {
    const token = ownedLeases.get(eventId);
    if (!token) return;
    const kind = /^(?:README|资料|仓库根目录)/.test(reason) || status === "insufficient_sources" ? "source" : /^(?:学习|模型)/.test(reason) ? "validation" : "transient";
    await queryRows(`UPDATE learning_contents SET status=$2,error_summary=$3,error_kind=$5,
      next_retry_at=CASE WHEN $5='source' OR attempts>=3 THEN NULL ELSE now() +
        (CASE WHEN $5='validation' THEN 3600 ELSE 900 END * power(2,attempts-1))*interval '1 second' END,
      lease_until=NULL,lease_token=NULL,updated_at=now()
      WHERE event_id=$1 AND status='processing' AND lease_until>=now() AND lease_token=$4`,
    [eventId,status,safeMessage(reason),token,kind]);
    ownedLeases.delete(eventId);
  },
};
