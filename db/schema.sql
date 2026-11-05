CREATE TABLE IF NOT EXISTS repositories (
  id text PRIMARY KEY,
  full_name text NOT NULL,
  description text NOT NULL DEFAULT '',
  url text NOT NULL,
  homepage text,
  language text,
  topics jsonb NOT NULL DEFAULT '[]',
  stars bigint NOT NULL CHECK (stars >= 0),
  forks bigint NOT NULL CHECK (forks >= 0),
  created_at timestamptz NOT NULL,
  pushed_at timestamptz NOT NULL,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now(),
  default_branch text NOT NULL,
  last_release_id text,
  last_release_published_at timestamptz
);
CREATE INDEX IF NOT EXISTS repositories_sync_idx ON repositories (synced_at, id);
CREATE INDEX IF NOT EXISTS repositories_stars_idx ON repositories (stars DESC, id);
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS last_sync_attempt_at timestamptz;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS repositories_sync_rotation_idx
  ON repositories ((COALESCE(last_sync_attempt_at, synced_at)), id) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS repository_snapshots (
  repository_id text NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  sample_day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  sampled_at timestamptz NOT NULL DEFAULT now(),
  stars bigint NOT NULL CHECK (stars >= 0),
  PRIMARY KEY (repository_id, sample_day)
);

CREATE TABLE IF NOT EXISTS feed_events (
  id text PRIMARY KEY,
  repository_id text NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('discovery', 'release')),
  title text NOT NULL,
  published_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  release_id text,
  release_tag text,
  release_url text,
  release_body text,
  UNIQUE (repository_id, release_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS feed_events_discovery_idx ON feed_events(repository_id) WHERE kind = 'discovery';
CREATE INDEX IF NOT EXISTS feed_events_time_idx ON feed_events(published_at DESC, id);

CREATE TABLE IF NOT EXISTS learning_contents (
  id text PRIMARY KEY,
  event_id text NOT NULL UNIQUE REFERENCES feed_events(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed', 'insufficient_sources')),
  article jsonb,
  model text,
  generated_at timestamptz,
  input_hash text,
  prompt_version text NOT NULL DEFAULT '1',
  input_tokens bigint,
  output_tokens bigint,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_until timestamptz,
  lease_token text,
  error_summary text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS learning_contents_pending_idx ON learning_contents(status, updated_at);
ALTER TABLE learning_contents ADD COLUMN IF NOT EXISTS lease_token text;

CREATE TABLE IF NOT EXISTS content_sources (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  content_id text NOT NULL REFERENCES learning_contents(id) ON DELETE CASCADE,
  url text NOT NULL,
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('readme', 'release', 'source', 'docs')),
  fetched_at timestamptz NOT NULL,
  revision text,
  UNIQUE(content_id, url)
);

CREATE TABLE IF NOT EXISTS collection_runs (
  id text PRIMARY KEY,
  discovery_scope text NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  discovered integer NOT NULL DEFAULT 0,
  generated integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

ALTER TABLE learning_contents ADD COLUMN IF NOT EXISTS depth text NOT NULL DEFAULT 'quick';
ALTER TABLE learning_contents ADD COLUMN IF NOT EXISTS requested_depth text NOT NULL DEFAULT 'quick';
ALTER TABLE learning_contents ADD COLUMN IF NOT EXISTS error_kind text;
ALTER TABLE learning_contents ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;
ALTER TABLE learning_contents ADD COLUMN IF NOT EXISTS refresh_requested_at timestamptz;
ALTER TABLE feed_events ADD COLUMN IF NOT EXISTS importance text NOT NULL DEFAULT 'minor';
CREATE TABLE IF NOT EXISTS content_versions (
  id text PRIMARY KEY,
  content_id text NOT NULL REFERENCES learning_contents(id) ON DELETE CASCADE,
  article jsonb NOT NULL,
  sources jsonb NOT NULL DEFAULT '[]',
  model text,
  generated_at timestamptz NOT NULL,
  depth text NOT NULL DEFAULT 'quick',
  input_hash text
);
ALTER TABLE content_versions DROP CONSTRAINT IF EXISTS content_versions_content_id_input_hash_key;
CREATE INDEX IF NOT EXISTS content_versions_latest_idx ON content_versions(content_id, generated_at DESC);
CREATE TABLE IF NOT EXISTS discovery_cursors (
  key text PRIMARY KEY,
  page integer NOT NULL DEFAULT 1 CHECK (page > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE content_sources ADD COLUMN IF NOT EXISTS reading_range text;
INSERT INTO content_versions (id,content_id,article,sources,model,generated_at,depth,input_hash)
SELECT 'version_' || md5(c.id || COALESCE(c.input_hash,'') || c.depth || COALESCE(c.model,'') || c.article::text),c.id,c.article,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('url',s.url,'title',s.title,'kind',s.kind,'fetchedAt',s.fetched_at,'revision',s.revision,'readingRange',s.reading_range) ORDER BY s.id) FROM content_sources s WHERE s.content_id=c.id),'[]'::jsonb),
  c.model,c.generated_at,c.depth,c.input_hash
FROM learning_contents c WHERE c.article IS NOT NULL AND c.generated_at IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM content_versions v WHERE v.content_id=c.id AND v.article=c.article
  AND v.input_hash IS NOT DISTINCT FROM c.input_hash AND v.depth=c.depth AND v.model IS NOT DISTINCT FROM c.model)
ON CONFLICT DO NOTHING;

ALTER TABLE repositories ADD COLUMN IF NOT EXISTS last_announcement_sha text;
ALTER TABLE feed_events DROP CONSTRAINT IF EXISTS feed_events_kind_check;
ALTER TABLE feed_events ADD CONSTRAINT feed_events_kind_check CHECK (kind IN ('discovery','release','announcement'));
