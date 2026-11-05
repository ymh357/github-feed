"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import type { CatalogItem, CatalogQuery, CatalogResult } from "@/lib/types";
import { FavoriteButton, FavoritesLink, PersonalTools, usePersonal } from "./personal-state";

const number = (value: number): string => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
const date = (value: string): string => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric" }).format(new Date(value));
const fullDate = (value: string): string => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const Star = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
  <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />
</svg>;
const Grid = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
  <rect x="3" y="3" width="7" height="7" rx="1.5" />
  <rect x="14" y="3" width="7" height="7" rx="1.5" />
  <rect x="3" y="14" width="7" height="7" rx="1.5" />
  <rect x="14" y="14" width="7" height="7" rx="1.5" />
</svg>;
const Pulse = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
  <path d="M3 12h4l3-8 4 16 3-8h4" strokeLinecap="round" strokeLinejoin="round" />
</svg>;

export const Brand = (): ReactElement => <Link href="/" className="brand" aria-label="GitHub Feed 首页">
  <span className="brand-mark">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 20" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </span>
  <span>GitHub <strong>Feed</strong><small>你的开源学习流</small></span>
</Link>;

const itemHref = (item: CatalogItem): string => item.event.kind === "release" ? `/updates/${encodeURIComponent(item.event.id)}` : `/projects/${item.repository.id}`;

const ProjectRow = ({ item, read }: { item: CatalogItem; read: boolean }) => {
  const { repository: repo, event, content } = item;
  const article = content?.article;
  const [owner, ...name] = repo.fullName.split("/");
  return <article className={`project-row ${read ? "has-read" : ""}`}>

    <div className="project-avatar" aria-hidden="true">
      {name.join("/").slice(0, 1).toUpperCase() || owner.slice(0, 1).toUpperCase()}
    </div>

    <div className="project-main">
      <div className="project-title-line">
        <h2>
          <Link href={itemHref(item)}>
            <span className="repo-owner">{owner} / </span>
            {name.join("/") || owner}
          </Link>
        </h2>
        <span className={`event-badge ${event.kind === "release" ? "release" : ""}`}>
          {event.kind === "release" ? event.releaseTag ?? "版本更新" : "新收录"}
        </span>
        {read && <span className="read-badge">已读</span>}
      </div>

      <p className="project-description">
        {article?.summary || repo.description || "项目暂未提供介绍。"}
      </p>

      {article?.reason ? <p className="project-reason">
        <span>值得关注</span>
        {article.reason}
      </p> : <p className="pending-caption">
        {content?.status === "insufficient_sources" ? "现有资料不足，学习解读尚未发布。" : content?.status === "failed" ? "解读暂未完成，可先查看项目原始资料。" : "学习解读整理中，可先查看项目资料。"}
      </p>}

      <div className="project-meta">
        <span className="star-stat" title={`${repo.stars.toLocaleString()} Star`}>
          <Star />
          {number(repo.stars)}
        </span>
        {repo.language && <span className="language-stat">
          <i />
          {repo.language}
        </span>}
        <span title={fullDate(event.publishedAt)}>
          {date(event.publishedAt)}
          {event.kind === "release" ? "发布" : "收录"}
        </span>
        {repo.starGrowth !== null && repo.growthDays !== null ? <span className="growth-stat">{repo.starGrowth >= 0 ? "+" : ""}{number(repo.starGrowth)} / {repo.growthDays} 天</span> : <span className="growth-unknown" title="需要两个有效快照才能计算增长">增长待积累</span>}
      </div>

    </div>
    <FavoriteButton id={repo.id} compact />

  </article>;
};

interface FeedProps { result: CatalogResult; query: CatalogQuery; view: "feed" | "projects" | "favorites" }

export const Feed = ({ result: initialResult, query, view }: FeedProps): ReactElement => {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { favorites, read } = usePersonal();
  const [retry, setRetry] = useState(0);
  const [personalResult, setPersonalResult] = useState<{ key: string; result?: CatalogResult; error?: string } | null>(null);
  const personal = view === "favorites" || (query.readState ?? "all") !== "all";
  const requestQuery = useMemo(() => ({ ...query, ...(view === "favorites" ? { ids: favorites } : {}), ...(query.readState && query.readState !== "all" ? { readEventIds: read } : {}) }), [query, view, favorites, read]);
  const requestKey = JSON.stringify(requestQuery);
  useEffect(() => {
    if (!personal) return;
    const controller = new AbortController();
    void fetch("/api/catalog", { method: "POST", headers: { "Content-Type": "application/json" }, body: requestKey, signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("暂时无法载入个人筛选结果，请重试。");
      const result = await response.json() as CatalogResult;
      if (!controller.signal.aborted) setPersonalResult({ key: requestKey, result });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setPersonalResult({ key: requestKey, error: error instanceof Error ? error.message : "载入失败，请重试。" });
    });
    return () => controller.abort();
  }, [personal, requestKey, retry]);
  const resolved: { result?: CatalogResult; error?: string } | null = personal ? personalResult?.key === requestKey ? personalResult : null : { result: initialResult };
  const result = resolved?.result;
  const loading = personal && !resolved;
  const linkTo = (updates: Record<string, string | null>): string => {
    const next = new URLSearchParams(search.toString());
    next.delete("ids");
    for (const [key, value] of Object.entries(updates)) value === null || value === "" ? next.delete(key) : next.set(key, value);
    return `${pathname}${next.size ? `?${next.toString()}` : ""}`;
  };
  const choose = (key: string, value: string): void => router.push(linkTo({ [key]: value, page: null }));
  const heading = view === "favorites" ? "我的收藏" : view === "projects" ? "项目榜单" : "发现与学习";
  const subtitle = view === "favorites" ? "把值得深入的项目留下来，按自己的节奏继续学习。" : view === "projects" ? "通过 Star 与时间发现项目，再理解背后的设计。" : "持续发现开源项目和版本变化，读懂它们的 What、Why、How。";
  const page = result?.page ?? query.page ?? 1;
  const pageCount = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  return <div className="app-shell">
    <aside className="sidebar">
      <Brand />
      <nav className="main-nav" aria-label="主导航">
        <Link className={view === "feed" ? "active" : ""} href="/">
          <Pulse />
          <span>最新信息</span>
        </Link>
        <Link className={view === "projects" ? "active" : ""} href="/?view=projects&sort=stars">
          <Grid />
          <span>项目榜单</span>
        </Link>
        <FavoritesLink className={view === "favorites" ? "active" : ""} />
      </nav>
      <div className="sidebar-guide">
        <p className="sidebar-label">让发现变成理解</p>
        <dl>
          <div>
            <dt>What</dt>
            <dd>它解决什么问题</dd>
          </div>
          <div>
            <dt>Why</dt>
            <dd>为什么值得关注</dd>
          </div>
          <div>
            <dt>How</dt>
            <dd>如何使用与实现</dd>
          </div>
        </dl>
      </div>
      <div className="sidebar-bottom">
        <div className="refresh-indicator">
          <span />
          {initialResult.lastUpdatedAt ? "每日发现，持续积累" : "等待首次更新"}
        </div>
        <PersonalTools />
      </div>
    </aside>

    <main id="main-content" className="feed-main">
      <header className="page-header">
        <div>
          <p className="page-kicker">开源世界，持续探索</p>
          <h1>
            {heading}
          </h1>
          <p className="page-subtitle">
            {subtitle}
          </p>
        </div>
        <a className="github-source-link" href="https://github.com" target="_blank" rel="noreferrer">浏览 GitHub<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="M14 3h7v7M21 3 10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />
        </svg></a>
      </header>

      <section className="catalog-panel" aria-label="项目列表">
        <div className="catalog-toolbar">
          <form className="search-form" action="/" role="search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m16 16 5 5" />
            </svg>
            <label className="visually-hidden" htmlFor="project-search">搜索项目、介绍或关键词</label>
            <input
              id="project-search"
              name="q"
              type="search"
              placeholder="搜索项目、介绍或关键词"
              defaultValue={query.q}
              key={query.q}
              maxLength={200}
            />
            {["view", "sort", "language", "minStars", "days", "readState"].map((name) => search.get(name) ? <input key={name} type="hidden" name={name} value={search.get(name)!} /> : null)}
            <button type="submit">搜索</button>
          </form>
          <label className="sort-control">
            <span>排序</span>
            <select value={query.sort ?? "recent"} onChange={(event) => choose("sort", event.target.value)}>
              <option value="recent">最新信息</option>
              <option value="stars">最多 Star</option>
              <option value="growth">Star 增长</option>
              <option value="created">最新创建</option>
              <option value="pushed">最近推送</option>
            </select>
          </label>
        </div>

        <div className="filter-bar">
          <label>
            <span>语言</span>
            <select value={query.language ?? ""} onChange={(event) => choose("language", event.target.value)}>
              <option value="">全部语言</option>
              {(result?.languages ?? initialResult.languages).map((language) => <option key={language} value={language}>
                {language}
              </option>)}
            </select>
          </label>
          <label>
            <span>Star</span>
            <select value={String(query.minStars ?? 0)} onChange={(event) => choose("minStars", event.target.value)}>
              <option value="0">不限 Star</option>
              <option value="1000">1,000 以上</option>
              <option value="10000">10,000 以上</option>
              <option value="50000">50,000 以上</option>
            </select>
          </label>
          <label>
            <span>时间</span>
            <select value={String(query.days ?? 0)} onChange={(event) => choose("days", event.target.value)}>
              <option value="0">全部时间</option>
              <option value="1">最近 1 天</option>
              <option value="7">最近 7 天</option>
              <option value="30">最近 30 天</option>
              <option value="90">最近 90 天</option>
            </select>
          </label>
          <label>
            <span>阅读</span>
            <select value={query.readState ?? "all"} onChange={(event) => choose("readState", event.target.value)}>
              <option value="all">全部状态</option>
              <option value="unread">未读</option>
              <option value="read">已读</option>
            </select>
          </label>
          {(query.q || query.language || query.minStars || query.days || query.readState !== "all") && <Link
            className="reset-filter"
            href={view === "favorites" ? "/?view=favorites" : view === "projects" ? "/?view=projects&sort=stars" : "/"}
          >重置筛选</Link>}
        </div>

        <div className="list-caption">
          <span>
            {loading ? "正在载入" : result ? `${result.total.toLocaleString()} ${view === "feed" ? "条信息" : "个项目"}` : "项目信息"}
          </span>
          <span>
            {result?.lastUpdatedAt ? `最近更新 ${fullDate(result.lastUpdatedAt)}` : "等待首次更新"}
          </span>
        </div>

        {loading ? <div className="empty-state" role="status">
          <span className="loading-ring" />
          <h2>正在载入你的学习流</h2>
          <p>正在按收藏与阅读记录筛选全部内容。</p>
        </div> : resolved?.error ? <div className="empty-state" role="alert">
          <h2>暂时无法载入</h2>
          <p>
            {resolved.error}
          </p>
          <button className="primary-button" onClick={() => setRetry((value) => value + 1)}>重新载入</button>
        </div> : result?.error ? <div className="empty-state" role="alert">
          <h2>内容暂时无法载入</h2>
          <p>数据服务暂时不可用，请稍后重新访问。</p>
          <button className="primary-button" onClick={() => { setRetry((value) => value + 1); router.refresh(); }}>重新载入</button>
        </div> : !result?.configured ? <div className="empty-state">
          <div className="empty-art">
            <Grid />
          </div>
          <h2>学习库正在准备</h2>
          <p>项目收集尚未开始。首次更新完成后，<br />这里将展示真实项目、版本变化和学习解读。</p>
          <div className="empty-explainer">
            <span>发现项目</span>
            <i />
            <span>理解价值</span>
            <i />
            <span>深入学习</span>
          </div>
        </div> : result.items.length === 0 ? <div className="empty-state">
          <div className="empty-art">
            <Grid />
          </div>
          <h2>
            {view === "favorites" && !favorites.length ? "把下一个好项目留在这里" : "暂时没有匹配的内容"}
          </h2>
          <p>
            {view === "favorites" && !favorites.length ? "浏览项目时点击收藏，之后可以在这里继续学习。" : "试试其他关键词，或放宽语言、Star 和时间筛选。"}
          </p>
          <Link className="primary-button" href="/">浏览最新信息</Link>
        </div> : <div className="project-list">
          {result.items.map((item) => <ProjectRow key={item.event.id} item={item} read={read.includes(item.event.id)} />)}
        </div>}

        {result && result.total > result.pageSize && <nav className="pagination" aria-label="列表分页">
          <Link
            aria-disabled={page <= 1}
            tabIndex={page <= 1 ? -1 : undefined}
            href={linkTo({ page: String(Math.max(1, page - 1)) })}
          >上一页</Link>
          <span>第 {page} / {pageCount} 页</span>
          <Link
            aria-disabled={page >= pageCount}
            tabIndex={page >= pageCount ? -1 : undefined}
            href={linkTo({ page: String(Math.min(pageCount, page + 1)) })}
          >下一页</Link>
        </nav>}

      </section>
      <footer className="page-footer">
        <span>发现没有终点，学习自有节奏。</span>
        <span>Star 是参考，理解才是收获。</span>
      </footer>

    </main>
  </div>;
};
