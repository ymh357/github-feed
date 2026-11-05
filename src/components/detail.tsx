"use client";

import Link from "next/link";
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { CatalogItem } from "@/lib/types";
import { Brand } from "./feed";
import { LearningTools } from "./learning-tools";
import { FavoriteButton, FavoritesLink, ReadMarker } from "./personal-state";

const fullDate = (value: string): string => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const safeHref = (value: string | null | undefined): string | null => {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" ? url.href : null; } catch { return null; }
};

const RichText = ({ text }: { text: string }) => <div className="article-prose">
  {text.split(/(```[\s\S]*?```)/g).filter(Boolean).map((block, index) => {
    if (block.startsWith("```")) {
      const code = block.replace(/^```[^\n]*\n?/, "").replace(/```$/, "");
      return <pre key={index}>
        <code>
          {code}
        </code>
      </pre>;
    }
    return block.trim().split(/\n\s*\n/).filter(Boolean).map((paragraph, paragraphIndex) => <p key={`${index}-${paragraphIndex}`}>
      {paragraph.trim()}
    </p>);
  })}
</div>;

const Section = ({ id, english, title, children }: { id: string; english?: string; title: string; children: ReactNode }) => <section id={id} className="article-section">
  <h2>
    {english && <span>
      {english}
    </span>}
    {title}
  </h2>
  {children}
</section>;

export const Detail = ({ item, updates, related = [], isUpdate = false }: { item: CatalogItem; updates: CatalogItem[]; related?: CatalogItem[]; isUpdate?: boolean }): ReactElement => {
  const { repository: repo, event, content } = item;
  const [versionId, setVersionId] = useState("current");
  const selectedVersion = content?.versions?.find((version) => version.id === versionId);
  const article = selectedVersion?.article ?? content?.article;
  const displayedSources = selectedVersion?.sources ?? content?.sources ?? [];
  const generatedAt = selectedVersion?.generatedAt ?? content?.generatedAt;
  const model = selectedVersion ? selectedVersion.model : content?.model;
  const depth = selectedVersion?.depth ?? content?.depth ?? "quick";
  const repoUrl = safeHref(repo.url);
  const homepage = safeHref(repo.homepage);
  const releaseUrl = safeHref(event.releaseUrl);
  const sourceEntries = displayedSources.flatMap((source, index) => {
    const href = safeHref(source.url);
    return href ? [{ ...source, href, sourceNumber: index + 1 }] : [];
  });
  const announcement = event.kind === "announcement";
  const title = isUpdate ? `${repo.fullName} ${announcement ? "官方文档变化" : event.releaseTag ?? "版本更新"}` : repo.fullName;
  return <div className="detail-shell">
    <header className="detail-topbar">
      <Brand />
      <nav aria-label="页面导航">
        <Link href="/">最新信息</Link>
        <FavoritesLink />
      </nav>
    </header>
    <main id="main-content" className="detail-main">
      <nav className="breadcrumbs" aria-label="当前位置">
        <Link href="/">学习流</Link>
        <span>/</span>
        {isUpdate && <>
          <Link href={`/projects/${repo.id}`}>
            {repo.fullName}
          </Link>
          <span>/</span>
        </>}
        <span>
          {isUpdate ? announcement ? "官方文档变化" : event.releaseTag ?? "版本更新" : repo.fullName}
        </span>
      </nav>

      <header className="detail-header">
        <div className="detail-heading">
          <div className="detail-heading-label">
            <span className={`event-badge ${isUpdate ? "release" : ""}`}>
              {isUpdate ? announcement ? "官方文档变化" : "正式版本更新" : "项目学习"}
            </span>
            {repo.language && <span className="language-stat">
              <i />
              {repo.language}
            </span>}
          </div>
          <h1>
            {title}
          </h1>
          <p>
            {article?.summary || repo.description || "项目暂未提供介绍。"}
          </p>
          <div className="detail-stats">
            <span><strong>
              {repo.stars.toLocaleString()}
            </strong> Star</span>
            <span>{repo.forks.toLocaleString()} Fork</span>
            <span>
              {repo.starGrowth === null ? "Star 增长待积累" : `${repo.starGrowth >= 0 ? "+" : ""}${repo.starGrowth.toLocaleString()} Star / ${repo.growthDays} 天`}
            </span>
          </div>
        </div>
        <div className="detail-actions">
          <FavoriteButton id={repo.id} />
          <ReadMarker eventId={event.id} available={Boolean(article)} />
          {repoUrl && <a className="primary-button" href={repoUrl} target="_blank" rel="noreferrer">查看仓库<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d="M14 3h7v7M21 3 10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />
          </svg></a>}
        </div>
      </header>

      <div className="detail-grid">
        <article className="learning-article">
          {article && <div className="version-picker">
            <label htmlFor="article-version">解读深度与历史版本</label>
            <select id="article-version" value={selectedVersion ? versionId : "current"} onChange={(event) => setVersionId(event.target.value)}>
              <option value="current">当前 · {content?.depth === "deep" ? "深入学习" : "快速理解"}{content?.generatedAt ? ` · ${fullDate(content.generatedAt)}` : ""}</option>
              {(content?.versions ?? []).map((version) => <option key={version.id} value={version.id}>{version.depth === "deep" ? "深入学习" : "快速理解"} · {fullDate(version.generatedAt)}</option>)}
            </select>
            <p>{depth === "deep" ? "深入学习解读，结合更多仓库文档与实现资料。" : "快速理解解读，先掌握问题、价值与使用入口。"} 各版本保留各自资料来源；尚未生成的深度不会显示为可读版本。</p>
            {content?.requestedDepth === "deep" && content.status !== "ready" && <p>深入解读正在等待后台处理；现有内容可以继续阅读。</p>}
          </div>}
          {content && content.status !== "ready" && <div className="content-status" role="status">
            <strong>{content.status === "processing" ? "正在整理" : content.status === "pending" ? "等待后台整理" : (content.attempts ?? 0) >= 3 ? "已暂停自动重试" : "整理暂未完成"}{article ? "，已有解读仍可阅读" : ""}</strong>
            {content.errorSummary && <p>{content.errorSummary}</p>}
            <p>已尝试 {content.attempts ?? 0} 次。{content.nextRetryAt ? `下次可重试时间：${fullDate(content.nextRetryAt)}。` : (content.attempts ?? 0) >= 3 ? "需由维护者核查后重新处理。" : "等待后续后台任务处理。"}</p>
          </div>}
          {article ? <>
            <div className="article-intro">
              <span className="article-intro-label">阅读切入点</span>
              <p>
                {article.reason}
              </p>
            </div>
            {isUpdate && article.changes && <Section id="changes" title="这次更新了什么">
              <RichText text={article.changes} />
              {releaseUrl && <a className="text-link" href={releaseUrl} target="_blank" rel="noreferrer">{announcement ? "查看原始文档变化" : "查看原始版本说明"}</a>}
            </Section>}
            <Section id="what" english="What" title="它解决什么问题">
              <RichText text={article.what} />
            </Section>
            <Section id="why" english="Why" title="为什么值得关注">
              <RichText text={article.why} />
            </Section>
            <Section id="how" english="How" title="如何使用与实现">
              <RichText text={article.how} />
              {article.sourcePaths.length > 0 && <div className="source-paths">
                <h3>源码阅读入口</h3>
                <ul>
                  {article.sourcePaths.map((path, index) => <li key={`${path}-${index}`}>
                    <code>
                      {path}
                    </code>
                  </li>)}
                </ul>
              </div>}
            </Section>
            <Section id="takeaways" title="可以带走的知识">
              <ul className="takeaways-list">
                {article.takeaways.map((takeaway, index) => <li key={index}>
                  {takeaway}
                </li>)}
              </ul>
            </Section>
            <Section id="exercise" title="动手试一试">
              <div className="exercise-box">
                <RichText text={article.exercise} />
              </div>
            </Section>
            {article.limitations.length > 0 && <Section id="limitations" title="适用边界与待确认事项">
              <ul className="limitations-list">
                {article.limitations.map((limitation, index) => <li key={index}>
                  {limitation}
                </li>)}
              </ul>
            </Section>}
            <div className="article-colophon">
              <p>解读依据下列原始资料整理，包含对设计思路的分析。具体使用方式请结合对应版本的官方文档确认。</p>
              {generatedAt && <span>整理于 {fullDate(generatedAt)}{model ? `，模型 ${model}` : ""}</span>}
            </div>
          </> : <div className="article-pending">
            <div className="empty-art">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4V4Zm16 0h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 4-3h3V4Z" />
              </svg>
            </div>
            <h2>
              {content?.status === "insufficient_sources" ? "还需要更多资料" : content?.status === "failed" ? "学习解读暂未完成" : "学习解读整理中"}
            </h2>
            <p>
              {content?.status === "insufficient_sources" ? "现有资料尚不足以支持完整解读，可以先阅读项目的原始文档。" : "项目已收录。What、Why、How 完成整理后会在这里展示，你也可以先从仓库开始探索。"}
            </p>
            {repoUrl && <a className="primary-button" href={repoUrl} target="_blank" rel="noreferrer">阅读项目资料</a>}
          </div>}
          <LearningTools repositoryId={repo.id} />
        </article>

        <aside className="detail-aside">
          {article && <nav className="article-toc" aria-label="文章目录">
            <h2>本页内容</h2>
            {isUpdate && article.changes && <a href="#changes">这次更新了什么</a>}
            <a href="#what"><span>What</span>它解决什么问题</a>
            <a href="#why"><span>Why</span>为什么值得关注</a>
            <a href="#how"><span>How</span>如何使用与实现</a>
            <a href="#takeaways">可以带走的知识</a>
            <a href="#exercise">动手试一试</a>
            {article.limitations.length > 0 && <a href="#limitations">适用边界</a>}
          </nav>}
          <section className="source-panel">
            <h2>原始资料</h2>
            {repoUrl && <a className="source-link" href={repoUrl} target="_blank" rel="noreferrer">
              <strong>GitHub 仓库</strong>
              <span>
                {repo.fullName}
              </span>
            </a>}
            {homepage && <a className="source-link" href={homepage} target="_blank" rel="noreferrer">
              <strong>项目网站</strong>
              <span>
                {new URL(homepage).hostname}
              </span>
            </a>}
            {sourceEntries.map((source, index) => <a className="source-link" href={source.href} target="_blank" rel="noreferrer" key={`${source.href}-${index}`}>
              <strong>
                资料{source.sourceNumber} · {source.title}
              </strong>
              <span>
                {source.kind === "source" ? "源码" : source.kind === "release" ? "版本说明" : source.kind === "readme" ? "项目说明" : "官方文档"}
                {source.revision ? ` · ${source.revision.slice(0, 8)}` : ""}
              </span>
              <span>核验于 {fullDate(source.fetchedAt)}</span>
              {source.readingRange && <span>读取范围：{source.readingRange}</span>}
            </a>)}
            <dl className="project-dates">
              <div>
                <dt>仓库创建</dt>
                <dd>
                  {fullDate(repo.createdAt)}
                </dd>
              </div>
              <div>
                <dt>最近代码推送</dt>
                <dd>
                  {fullDate(repo.pushedAt)}
                </dd>
              </div>
              <div>
                <dt>首次收录</dt>
                <dd>
                  {fullDate(repo.discoveredAt)}
                </dd>
              </div>
              <div>
                <dt>项目数据同步</dt>
                <dd>
                  {fullDate(repo.syncedAt)}
                </dd>
              </div>
            </dl>
          </section>
          {related.length > 0 && <section className="updates-panel">
            <h2>继续探索</h2>
            <p className="related-explanation">按共同主题或语言关联，不代表质量排名。</p>
            {related.map((candidate) => <Link key={candidate.repository.id} href={`/projects/${candidate.repository.id}`}><strong>{candidate.repository.fullName}</strong><span>{candidate.content?.article?.summary ?? candidate.repository.description}</span></Link>)}
          </section>}
          {updates.length > 0 && <section className="updates-panel">
            <h2>版本动态</h2>
            {updates.map((update) => <Link key={update.event.id} href={`/updates/${encodeURIComponent(update.event.id)}`}>
              <strong>
                {update.event.releaseTag ?? update.event.title}
              </strong>
              <span>
                {fullDate(update.event.publishedAt)}
              </span>
            </Link>)}
          </section>}
        </aside>

      </div>
      <footer className="detail-footer">
        <Link href="/">返回学习流</Link>
        {isUpdate && <Link href={`/projects/${repo.id}`}>查看完整项目</Link>}
      </footer>

    </main>
  </div>;
};
