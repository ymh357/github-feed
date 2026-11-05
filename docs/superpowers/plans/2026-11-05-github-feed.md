# GitHub Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement the independent tasks below.

**Goal:** 交付持续收集 GitHub 项目与正式版本、提供中文学习详情和本地收藏的公开网站。

**Architecture:** Next.js 展示 Neon 中的持久化内容；GitHub Actions 每日运行有界、可续跑的收集与 0G 生成任务。浏览器独立保存收藏和已读。

**Tech Stack:** Next.js 16.4.5、React 19.3.1、TypeScript、ESLint、Neon serverless PostgreSQL、0G Router。

**Spec:** docs/superpowers/specs/2026-11-05-github-feed-design.md

## Global Constraints

- 用户最新指令授权一次性完成，覆盖此前逐阶段等待；继续按职责拆分文件和验证，不重复询问设计。
- 不新增自动化测试；运行类型检查、ESLint、构建与实际流程检查。
- 安装依赖和启动预览已获授权；仓库创建、commit/push 与部署等待明确授权。
- 不打印密钥。缺少数据库时展示准确的未配置状态，不能用演示数据冒充真实收集结果。
- 对数据库/模型未配置的部分保留明确运行指导，不能声称真实自动更新已验证。

## Review Focus

- 外部仓库内容不可信：只读资料，限制输入，模型结果按结构化内容安全渲染。
- 模型失败或限流：保留旧内容，任务可恢复，不能无限重试或消耗。
- 排序分页：使用数据库排序与稳定 tie-breaker；缺失增长基线保持未知。
- localStorage 不可用或损坏：页面可浏览，状态失败可见，导入限大小和结构。
- 线上凭据和权限：公开页面不包含服务端连接；外部授权缺失明确报告。

## 任务及所有权

### 1. 主代理：基础配置、契约和集成

- [x] 创建 package.json、tsconfig.json、next-env.d.ts、eslint.config.mjs、next.config.ts、.gitignore、.env.example。
- [x] 创建 src/lib/types.ts，作为所有子任务唯一共享结构契约。
- [x] 安装锁定版本的依赖，验证 Node >=20.9。
- [x] 集成错误/未找到页面、部署工作流与 README。

### 2. 页面代理：列表、详情与个人状态（8 文件）

所有权：src/app/layout.tsx、src/app/page.tsx、src/app/projects/[id]/page.tsx、src/app/updates/[id]/page.tsx、src/app/globals.css、src/components/feed.tsx、src/components/detail.tsx、src/components/personal-state.tsx。

- [x] 读取共享类型；使用 getCatalog、getProject、getUpdate 获取服务端数据。
- [x] 构建阅读优先、蓝灰底色与蓝色强调、紧凑项目列表和详情目录。
- [x] 实现 URL 搜索筛选、排序分页、本地已读收藏及导入导出。
- [x] 缺数据/配置/故障时显示不同状态，不嵌入虚构学习项目。

### 3. 数据代理：数据库、查询和运维脚本（6 文件）

所有权：db/schema.sql、src/lib/db.ts、src/lib/catalog.ts、scripts/migrate.ts、scripts/health.ts、src/lib/store.ts。

- [x] 创建六张业务表，唯一约束防重复；支持过期 processing 租约恢复。
- [x] 实现数据库惰性连接及 getCatalog/getProject/getUpdate 查询。
- [x] 实现 ingestion 使用的持久化接口（见 src/lib/types.ts 的 StoreContract）。
- [x] 实现迁移和健康检查；无凭据清楚失败，不输出连接字符串。

### 4. 收集代理：GitHub、资料、模型与工作流（6 文件）

所有权：src/lib/github.ts、src/lib/sources.ts、src/lib/ai.ts、scripts/collect.ts、scripts/compare-models.ts、.github/workflows/collect.yml。

- [x] 有界搜索候选并轮转同步；遵守 GitHub 限流，追踪正式版本。
- [x] 读取固定 commit 的 README/关键源码并保存来源身份，限制资料体积。
- [x] 0G 结构化生成与结果校验；模型 ID 来自配置，使用实际目录检查。
- [x] collect --dry-run 只读取并报告，不写数据库、不调用付费模型。
- [x] 提供 --discovery-only、--limit 参数与有界重试，任务失败非零退出。
- [x] 每日定时与手动工作流，不向仓库提交数据。

## 共享接口

具体结构位于 src/lib/types.ts。页面仅消费 CatalogResult、ProjectResult、UpdateResult。收集器使用 store 导出的 StoreContract 方法；数据库代理不能改变共享字段而不通知其他代理。

## 集成与交付

- [x] npx tsc --noEmit，修复全部错误。
- [x] npx eslint . --quiet，修复全部错误。
- [x] npm run build，确认生产路由编译成功。
- [x] 实际预览列表、空状态、筛选、详情路径、响应式与本地状态。
- [x] 临时数据库迁移、真实发现、收集幂等及详情真实数据查询检查。
- [x] 取得 0G Key 后执行两模型真实调用和付费生成链路，修复 JSON 围栏兼容，选择 claude-sonnet-5。
- [x] 按已确认部署方案，从本地源码部署个人 Vercel 项目，验证公开网站。
- [ ] 取得 Git 授权后创建/推送私有仓库、配置 Actions Secrets、验证真实定时运行。
- [x] 更新 README 与交付状态，区分本地验证、上线验证及待用户操作。

## 执行记录

- 用户授权一次性推进，故不执行技能中的再次设计/计划审批。
- 用户未要求自动化测试，故替换技能默认 TDD 为静态与实际运行验证。
- 初始 GitHub、Vercel CLI 已登录；数据库与 0G Key 未配置。
- 已创建 Neon 临时数据库用于实际验证，连接仅写入被忽略的本地文件；到期前需用户认领以持续使用。
- 已收录 6 个真实项目；两次重复收集没有重复事件；首篇解读由本次 Codex 会话根据固定来源整理并保存，不是 0G 模型评测结果。
- 独立审查发现并修复同步队列饥饿、预发布版本挤出正式版本窗口问题，复审未发现新的确定 P1/P2。
- 此前图形浏览器因锁屏不可用；用户本轮操作后已补齐实际浏览器收藏、已读、搜索排序、导入导出与手机布局检查。
- 0G Key 已配置；当前 6 条内容全部 ready，其中 5 篇由真实 Sonnet 调用生成，1 篇为先前 Codex 样例。
- 网站已部署至 https://github-feed-nine.vercel.app，匿名请求与浏览器验证均通过；Git 写操作尚未执行，定时更新尚未启用。
