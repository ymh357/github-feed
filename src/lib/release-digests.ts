import { getDb } from "./db";

export const reconcileReleaseDigests = async (): Promise<number> => {
  const db = getDb();
  const results = await db.transaction([
    db.query("SELECT pg_advisory_xact_lock(hashtext('github-feed-release-digests'))"),
    db.query(`WITH candidates AS MATERIALIZED (
      SELECT e.id,e.repository_id,e.published_at,e.release_tag,e.title,e.release_url,e.release_body,
        (e.published_at AT TIME ZONE 'UTC')::date AS day,c.attempts,c.next_retry_at,c.error_summary,
        CASE WHEN c.error_kind IS NOT NULL THEN c.error_kind WHEN c.attempts>0 THEN 'transient' ELSE '' END AS error_kind
      FROM feed_events e JOIN learning_contents c ON c.event_id=e.id
      JOIN repositories r ON r.id=e.repository_id
      WHERE e.kind='release' AND e.importance='minor' AND e.digest_event_id IS NULL AND c.article IS NULL
        AND r.is_active AND r.admission_status='eligible' AND r.stars>=1000
        AND (c.status IN ('pending','failed','insufficient_sources') OR
          (c.status='processing' AND c.lease_until<now()))
      ORDER BY e.repository_id,e.published_at,e.id LIMIT 5000
      FOR UPDATE OF c SKIP LOCKED
    ), numbered AS (
      SELECT *,((row_number() OVER (PARTITION BY repository_id,day,attempts,error_kind
        ORDER BY published_at,id)-1)/40)::integer AS batch FROM candidates
    ), grouped AS (
      SELECT repository_id,day,attempts,error_kind,batch,
        'digest_'||repository_id||'_'||day::text||'_'||md5(string_agg(id,',' ORDER BY id)) AS digest_id,
        array_agg(id ORDER BY published_at,id) AS member_ids,
        max(published_at) AS published_at,
        (array_agg(release_tag ORDER BY published_at DESC,id DESC))[1] AS latest_tag,
        (array_agg(release_url ORDER BY published_at DESC,id DESC))[1] AS latest_url,
        day::text||' 版本变更摘要（'||count(*)::text||' 项）' AS title,
        string_agg(COALESCE(release_tag,title),', ' ORDER BY published_at,id) AS summary,
        max(next_retry_at) AS next_retry_at,max(error_summary) AS error_summary,
        jsonb_agg(jsonb_build_object('id',id,'tag',COALESCE(release_tag,''),'title',title,
          'url',COALESCE(release_url,''),'body',left(COALESCE(release_body,''),16000),
          'bodyTruncated',length(COALESCE(release_body,''))>16000,'publishedAt',published_at)
          ORDER BY published_at,id) AS entries
      FROM numbered GROUP BY repository_id,day,attempts,error_kind,batch
    ), inserted AS (
      INSERT INTO feed_events(id,repository_id,kind,title,published_at,release_tag,release_url,
        release_body,importance,digest_day,release_entries)
      SELECT digest_id,repository_id,'release_digest',title,published_at,latest_tag,latest_url,
        summary,'minor',day,entries FROM grouped ON CONFLICT DO NOTHING RETURNING id
    ), linked AS (
      UPDATE feed_events e SET digest_event_id=g.digest_id FROM grouped g JOIN inserted i ON i.id=g.digest_id
      WHERE e.id=ANY(g.member_ids) AND e.digest_event_id IS NULL RETURNING e.id
    ), contents AS (
      INSERT INTO learning_contents(id,event_id,status,attempts,next_retry_at,error_kind,error_summary)
      SELECT 'content_'||g.digest_id,g.digest_id,
        CASE WHEN g.error_kind='source' THEN 'insufficient_sources' WHEN g.attempts>0 THEN 'failed' ELSE 'pending' END,
        g.attempts,g.next_retry_at,NULLIF(g.error_kind,''),g.error_summary
      FROM grouped g JOIN inserted i ON i.id=g.digest_id ON CONFLICT DO NOTHING RETURNING id
    ) SELECT count(*)::integer AS created FROM inserted`),
  ]);
  return Number(results[1][0]?.created ?? 0);
};
