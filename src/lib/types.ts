export type EventKind = "discovery" | "release";
export type ContentStatus = "pending" | "processing" | "ready" | "failed" | "insufficient_sources";
export type SortKey = "recent" | "stars" | "created" | "pushed" | "growth";

export interface Repository {
  id: string;
  fullName: string;
  description: string;
  url: string;
  homepage: string | null;
  language: string | null;
  topics: string[];
  stars: number;
  forks: number;
  createdAt: string;
  pushedAt: string;
  discoveredAt: string;
  syncedAt: string;
  defaultBranch: string;
  lastReleaseId: string | null;
  starGrowth: number | null;
  growthDays: number | null;
}

export interface FeedEvent {
  id: string;
  repositoryId: string;
  kind: EventKind;
  title: string;
  publishedAt: string;
  observedAt: string;
  releaseId: string | null;
  releaseTag: string | null;
  releaseUrl: string | null;
  releaseBody: string | null;
}

export interface ContentSection {
  title: string;
  body: string;
}

export interface ContentSource {
  url: string;
  title: string;
  kind: "readme" | "release" | "source" | "docs";
  fetchedAt: string;
  revision: string | null;
  text?: string;
}

export interface LearningArticle {
  summary: string;
  reason: string;
  what: string;
  why: string;
  how: string;
  takeaways: string[];
  exercise: string;
  limitations: string[];
  changes: string | null;
  sourcePaths: string[];
}

export interface LearningContent {
  id: string;
  eventId: string;
  status: ContentStatus;
  article: LearningArticle | null;
  sources: ContentSource[];
  model: string | null;
  generatedAt: string | null;
  inputHash: string | null;
  promptVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface CatalogItem {
  repository: Repository;
  event: FeedEvent;
  content: LearningContent | null;
}

export interface CatalogQuery {
  q?: string;
  sort?: SortKey;
  view?: "feed" | "projects";
  language?: string;
  minStars?: number;
  days?: number;
  page?: number;
  ids?: string[];
  readEventIds?: string[];
  readState?: "all" | "read" | "unread";
}

export interface CatalogResult {
  items: CatalogItem[];
  total: number;
  page: number;
  pageSize: number;
  languages: string[];
  lastUpdatedAt: string | null;
  configured: boolean;
  error: boolean;
}

export interface ProjectResult {
  repository: Repository;
  item: CatalogItem;
  updates: CatalogItem[];
}

export interface UpdateResult {
  item: CatalogItem;
  project: Repository;
}

export interface GitHubRepositoryInput {
  id: string;
  fullName: string;
  description: string;
  url: string;
  homepage: string | null;
  language: string | null;
  topics: string[];
  stars: number;
  forks: number;
  createdAt: string;
  pushedAt: string;
  defaultBranch: string;
}

export interface ReleaseInput {
  id: string;
  tag: string;
  title: string;
  body: string;
  url: string;
  publishedAt: string;
}

export interface ContentWrite {
  eventId: string;
  article: LearningArticle;
  sources: ContentSource[];
  model: string;
  inputHash: string;
  promptVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface CollectionRunInput {
  discoveryScope: string;
}

export interface RunFinish {
  status: "completed" | "partial" | "failed";
  discovered: number;
  generated: number;
  failed: number;
  message?: string;
}

export interface StoreContract {
  startRun(input: CollectionRunInput): Promise<string>;
  finishRun(id: string, result: RunFinish): Promise<void>;
  upsertRepository(input: GitHubRepositoryInput): Promise<{ repository: Repository; isNew: boolean }>;
  recordSnapshot(repositoryId: string, stars: number): Promise<void>;
  recordRelease(repositoryId: string, release: ReleaseInput, baseline: boolean): Promise<void>;
  getRepositoriesToSync(limit: number): Promise<Repository[]>;
  recordSyncAttempt(repositoryId: string): Promise<void>;
  retireRepository(repositoryId: string): Promise<void>;
  getPendingEvents(limit: number): Promise<CatalogItem[]>;
  claimEvent(eventId: string): Promise<boolean>;
  saveContent(input: ContentWrite): Promise<void>;
  failContent(eventId: string, status: "failed" | "insufficient_sources", reason: string): Promise<void>;
}
