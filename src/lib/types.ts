export type EventKind = "discovery" | "release" | "announcement";
export type ContentStatus = "pending" | "processing" | "ready" | "failed" | "insufficient_sources";
export type ContentDepth = "quick" | "deep";
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
  growth1d?: number | null;
  growth7d?: number | null;
  admissionStatus?: "candidate" | "eligible";
  admissionReason?: string;
  discoveryChannels?: string[];
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
  importance?: "major" | "minor";
  groupedReleaseCount?: number;
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
  readingRange?: string;
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

export interface ContentVersion {
  id: string;
  article: LearningArticle;
  sources: ContentSource[];
  model: string | null;
  generatedAt: string;
  depth: ContentDepth;
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
  depth?: ContentDepth;
  requestedDepth?: ContentDepth;
  errorSummary?: string | null;
  errorKind?: string | null;
  attempts?: number;
  nextRetryAt?: string | null;
  versions?: ContentVersion[];
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
  contentState?: "ready" | "pending" | "failed";
  growthWindow?: "1d" | "7d";
  groupMinorReleases?: boolean;
}

export interface CollectionHealth {
  lastRunStatus: string | null;
  lastRunAt: string | null;
  discovered: number;
  generated: number;
  failed: number;
  pending: number;
  processing: number;
  retryable: number;
  exhausted: number;
  staleRepositories: number;
  ready: number;
  failedContents: number;
  lastSuccessfulAt: string | null;
  stale?: boolean;
  generationStatus?: string | null;
  generationMessage?: string | null;
  generationAt?: string | null;
  generationGenerated?: number;
  generationFailed?: number;
  lastSuccessfulGenerationAt?: string | null;
  lastGeneratedAt?: string | null;
  generationStale?: boolean;
  pendingProjects?: number;
  pendingUpdates?: number;
  pendingRefresh?: number;
  pendingDeep?: number;
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
  health?: CollectionHealth;
  coverage?: { scope: string | null; updatedAt: string | null };
}

export interface ProjectResult {
  repository: Repository;
  item: CatalogItem;
  updates: CatalogItem[];
  related?: CatalogItem[];
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
  discoveryChannels?: string[];
  admissionReason?: string;
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
  depth?: ContentDepth;
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
  setRunScope(id: string, scope: string): Promise<void>;
  finishRun(id: string, result: RunFinish): Promise<void>;
  upsertRepository(input: GitHubRepositoryInput): Promise<{ repository: Repository; isNew: boolean }>;
  recordSnapshot(repositoryId: string, stars: number): Promise<void>;
  recordRelease(repositoryId: string, release: ReleaseInput, baseline: boolean): Promise<void>;
  getRepositoriesToSync(limit: number): Promise<Repository[]>;
  recordSyncAttempt(repositoryId: string): Promise<void>;
  retireRepository(repositoryId: string): Promise<void>;
  getPendingEvents(limit: number, options?: { depth?: ContentDepth; repository?: string }): Promise<CatalogItem[]>;
  claimEvent(eventId: string): Promise<boolean>;
  saveContent(input: ContentWrite): Promise<void>;
  recordAnnouncement(repositoryId: string, announcement: { sha: string; title: string; body: string; path: string; url: string; publishedAt: string }): Promise<void>;
  getDeepCandidates(limit: number): Promise<Repository[]>;
  getDiscoveryCursor(key: string): Promise<number>;
  advanceDiscoveryCursor(key: string, page: number): Promise<void>;
  queueRefresh(limit: number): Promise<number>;
  resetContent(repositoryName: string, options?: { depth?: ContentDepth; retryOnly?: boolean }): Promise<number>;
  failContent(eventId: string, status: "failed" | "insufficient_sources", reason: string): Promise<void>;
}
