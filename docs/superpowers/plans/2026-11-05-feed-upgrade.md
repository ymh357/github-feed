# GitHub Feed 17 项升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** 实施用户已批准的全部 17 项首版局限优化，让持续发现、可靠学习与个人沉淀形成完整链路。
**Architecture:** 延续 Next.js / Neon / GitHub Actions / 0G，采集和生成后台执行，个人笔记、阅读与进度只存浏览器。数据库迁移幂等，现有内容与个人记录兼容保留。
**Tech Stack:** 现有 TypeScript、React、Next.js、Neon，无新增依赖。
**Spec:** 本轮用户批准的 17 项审计列表，以及现有 2026-11-05-github-feed-design.md。

## Global Constraints
- 不登录；不限制历史阅览；不执行第三方仓库代码；不把内部管理操作开放成无鉴权写接口。
- 不新增自动化测试文件，遵用户要求。使用类型检查、ESLint、构建与真实有界采集验证。
- 每个开发批次最多 5 个文件（跨批次任务另行划分），共享目录不覆盖他人修改。
- 用户已授权全部优化与既有发布路径；不新增付费基础设施。

## Review Focus
- 长 README、非标准目录和缺失源码仍需正确说明读取范围。
- 单项失败不能伪装整体停机；耗尽重试可通过私有 CLI 恢复。
- 旧浏览器导出记录兼容，不因升级丢失收藏或已读。
- 深度与旧版文章保留固定来源，不把不同 revision 混为实测。
- 增长排序只比较同一有效窗口；收藏按项目去重。

## 任务与接口
- [x] 数据批次 A：types.ts、db.ts、catalog.ts、db/schema.sql。暴露内容状态(errorSummary,attempts,nextRetryAt)、versions、健康统计、可比 growth1d/growth7d，全文搜索、收藏去重、版本重要性与聚合、相关项目。
- [x] 数据批次 B：store.ts 与 scripts/manage-content.ts。后台重试/刷新、失败分类与退避、版本归档、同步优先级、持久发现游标接口。
- [x] 采集批次 A：github.ts、sources.ts、ai.ts。五路以上发现+游标，长文本章节选取、文档与核心源码、quick/deep深度、引用编号与敏感事实审核。
- [x] 采集批次 B：scripts/collect.ts、.github/workflows/collect.yml。阶段独立调度、有限并发、重试份额、刷新队列、稳定运行统计；限流与基础故障仍失败，单项错误 partial 可观测。
- [x] 前端批次 A：personal-state.tsx、新 learning-tools.tsx、detail.tsx。手动已读/撤销、笔记与进度、深度与历史版本、关联项目、准确失败原因。
- [x] 前端批次 B：feed.tsx、globals.css。状态筛选、健康与积压、增长窗口、唯一收藏项目、合并小版本。feed.tsx 结构调整前先检查并清理死代码，单独提交。
- [x] 集成：类型与 lint、构建，迁移两次；真实长 README 与失败恢复；云端工作流、公开网站与本地记录兼容检查。
- [x] 独立审查与修复，更新文档并按既有授权推送和部署。

## 共享接口约定
- collectSources(item, depth?: 'quick'|'deep') 与 generateLearning(item,sources,model,depth?: 'quick'|'deep') 保持现有三参数兼容。
- ContentWrite 增可选 depth；LearningContent 增可选 depth/errorSummary/attempts/nextRetryAt/versions。
- ContentVersion: id,article,sources,model,generatedAt,depth ('quick'|'deep')。
- CatalogResult 增可选 health 与 coverage；CatalogQuery 增可选 contentState ('ready'|'pending'|'failed')、growthWindow ('1d'|'7d')。
- ProjectResult 增可选 related: CatalogItem[]；FeedEvent 增可选 importance ('major'|'minor')。
- StoreContract 新增 getDiscoveryCursor(key): Promise<number>, advanceDiscoveryCursor(key,page):Promise<void>, queueRefresh(limit):Promise<number>；额外 pending/sync options 用可选第二参数保持兼容。
- 数据层新增字段默认值兼容旧数据。前端先读可选字段，不依赖数据库迁移先后。

## 收尾证据

完整执行与边界见 docs/verification-upgrade-2026-11-05.md。feed.tsx检查无死代码、unused props/imports或debug日志，因此未制造空清理提交。所有功能已提交；云端同步与生成手动执行均成功，首次自然定时触发仍待观察。文件导入浏览器自动化受扩展权限限制，兼容解析已验证。
