import { getCatalog } from "@/lib/catalog";
import type { CatalogQuery, SortKey } from "@/lib/types";
import { Feed } from "@/components/feed";
import type { ReactElement } from "react";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
const scalar = (value: string | string[] | undefined): string => typeof value === "string" ? value : "";
const integer = (value: string, fallback: number): number => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;

const HomePage = async ({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<ReactElement> => {
  const params = await searchParams;
  const requestedSort = scalar(params.sort);
  const sorts: SortKey[] = ["recent", "stars", "created", "pushed", "growth"];
  const view = scalar(params.view);
  const query: CatalogQuery = {
    q: scalar(params.q).slice(0, 200),
    contentState: scalar(params.contentState) === "ready" ? "ready" : scalar(params.contentState) === "pending" ? "pending" : scalar(params.contentState) === "failed" ? "failed" : undefined,
    growthWindow: scalar(params.growthWindow) === "1d" ? "1d" : "7d",
    groupMinorReleases: scalar(params.groupMinorReleases) !== "false",
    sort: sorts.includes(requestedSort as SortKey) ? requestedSort as SortKey : view === "projects" ? "stars" : "recent",
    view: view === "projects" || view === "favorites" ? "projects" : "feed",
    language: scalar(params.language).slice(0, 80),
    minStars: integer(scalar(params.minStars), 0),
    days: integer(scalar(params.days), 0),
    page: Math.max(1, integer(scalar(params.page), 1)),
    readState: scalar(params.readState) === "read" ? "read" : scalar(params.readState) === "unread" ? "unread" : "all",
    ...(view === "favorites" ? { ids: [] } : {}),
  };
  const result = await getCatalog(query);
  return <Feed result={result} query={query} view={view === "favorites" ? "favorites" : query.view ?? "feed"} />;
};

export default HomePage;
