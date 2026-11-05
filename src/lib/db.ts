import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { CatalogItem, ContentSource, FeedEvent, LearningContent, Repository } from "./types";

export type DbRow = Record<string, unknown>;

let connection: NeonQueryFunction<false, false> | undefined;

export const isDatabaseConfigured = (): boolean => Boolean(process.env.DATABASE_URL?.trim());

export const getDb = (): NeonQueryFunction<false, false> => {
  if (typeof window !== "undefined") throw new Error("Database access is server-side only");
  if (!connection) {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) throw new Error("DATABASE_URL is not configured");
    connection = neon(url, { fetchOptions: { cache: "no-store" } });
  }
  return connection;
};

export const queryRows = async (text: string, params: unknown[] = []): Promise<DbRow[]> =>
  await getDb().query(text, params) as DbRow[];

const dateString = (value: unknown): string => value instanceof Date ? value.toISOString() : String(value);
const nullableString = (value: unknown): string | null => value === null || value === undefined ? null : String(value);

export const mapRepository = (row: DbRow): Repository => ({
  id: String(row.id),
  fullName: String(row.full_name),
  description: String(row.description ?? ""),
  url: String(row.url),
  homepage: nullableString(row.homepage),
  language: nullableString(row.language),
  topics: Array.isArray(row.topics) ? row.topics as string[] : [],
  stars: Number(row.stars),
  forks: Number(row.forks),
  createdAt: dateString(row.created_at),
  pushedAt: dateString(row.pushed_at),
  discoveredAt: dateString(row.discovered_at),
  syncedAt: dateString(row.synced_at),
  defaultBranch: String(row.default_branch),
  lastReleaseId: nullableString(row.last_release_id),
  starGrowth: row.star_growth === null || row.star_growth === undefined ? null : Number(row.star_growth),
  growthDays: row.growth_days === null || row.growth_days === undefined ? null : Number(row.growth_days),
});

export const mapCatalogItem = (row: DbRow): CatalogItem => {
  const event: FeedEvent = {
    id: String(row.event_id), repositoryId: String(row.id), kind: row.kind as FeedEvent["kind"],
    title: String(row.event_title), publishedAt: dateString(row.published_at), observedAt: dateString(row.observed_at),
    releaseId: nullableString(row.release_id), releaseTag: nullableString(row.release_tag),
    releaseUrl: nullableString(row.release_url), releaseBody: nullableString(row.release_body),
  };
  const content: LearningContent | null = row.content_id ? {
    id: String(row.content_id), eventId: event.id, status: row.content_status as LearningContent["status"],
    article: row.article as LearningContent["article"], sources: (row.sources ?? []) as ContentSource[],
    model: nullableString(row.model), generatedAt: row.generated_at ? dateString(row.generated_at) : null,
    inputHash: nullableString(row.input_hash), promptVersion: String(row.prompt_version ?? "1"),
    inputTokens: row.input_tokens === null || row.input_tokens === undefined ? null : Number(row.input_tokens),
    outputTokens: row.output_tokens === null || row.output_tokens === undefined ? null : Number(row.output_tokens),
  } : null;
  return { repository: mapRepository(row), event, content };
};

export const ITEM_SELECT = `r.*, e.id AS event_id, e.kind, e.title AS event_title,
  e.published_at, e.observed_at, e.release_id, e.release_tag, e.release_url, e.release_body,
  c.id AS content_id, c.status AS content_status, c.article, c.model, c.generated_at,
  c.input_hash, c.prompt_version, c.input_tokens, c.output_tokens,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'url', s.url, 'title', s.title, 'kind', s.kind, 'fetchedAt', s.fetched_at, 'revision', s.revision
  ) ORDER BY s.id) FROM content_sources s WHERE s.content_id = c.id), '[]'::jsonb) AS sources,
  latest.stars - baseline.stars AS star_growth,
  round(EXTRACT(EPOCH FROM (latest.sampled_at - baseline.sampled_at)) / 86400.0, 4) AS growth_days`;

export const ITEM_JOINS = `JOIN repositories r ON r.id = e.repository_id
  LEFT JOIN learning_contents c ON c.event_id = e.id
  LEFT JOIN LATERAL (
    SELECT stars, sampled_at FROM repository_snapshots WHERE repository_id = r.id ORDER BY sampled_at DESC LIMIT 1
  ) latest ON true
  LEFT JOIN LATERAL (
    SELECT stars, sampled_at FROM repository_snapshots
    WHERE repository_id = r.id AND sampled_at < latest.sampled_at
    ORDER BY (sampled_at <= latest.sampled_at - interval '7 days') DESC, sampled_at DESC LIMIT 1
  ) baseline ON true`;
