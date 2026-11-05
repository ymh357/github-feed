# GitHub Feed

持续更新的 GitHub 项目学习库。列表用于发现新项目和正式版本，详情提供有来源的中文 What / Why / How；收藏与已读保存在浏览器。

## 技术与运行方式

- Next.js / React / TypeScript：公开网站，适合 Vercel Hobby。
- Neon PostgreSQL：项目、信息流事件、Star 快照、解读与任务记录。
- GitHub Actions：每日分批发现与同步，直接写数据库，不提交内容到仓库。
- 0G Router：服务端生成并保存解读；访问页面不调用付费模型。

基础设施使用免费套餐起步，具体消耗取决于规模与账号额度。AI 推理单独计费。源码仓库可以私有，网站仍可公开访问。

## 本地配置

需要 Node.js >=20.9，推荐 Node.js 22。

```bash
npm ci
cp .env.example .env.local
```

在 `.env.local` 填写：

| 变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | Neon 的 PostgreSQL 连接，建议使用 pooled URL |
| `ZERO_G_API_KEY` | 0G inference API Key，只能用于后台 |
| `ZERO_G_MODEL` | 首版使用 `claude-sonnet-5`；使用目录中的准确 ID |
| `ZERO_G_COMPARE_MODELS` | 可选，比较模型 ID，逗号分隔 |
| `GH_TOKEN` | 可选，本地 GitHub API 只读 token；避免匿名限流 |
| `NEXT_PUBLIC_SITE_URL` | 可选，部署后的站点根地址 |

不要把密钥提交到 Git、浏览器代码、截图或聊天。`.env.local` 已忽略。没有数据库配置时网页显示准确的初始化状态，不会展示虚构项目。

```bash
npm run db:migrate
npm run health
npm run collect -- --dry-run --limit 5
npm run collect -- --discovery-only --limit 10
npm run collect -- --limit 10
npm run dev
```

`--dry-run` 不写数据库，也不调用付费模型。`--discovery-only` 可先验证真实数据收集，完整收集才生成学习内容。每次任务有界，未处理内容留到后续运行，不限制阅读历史。

模型目录与接入：[模型目录](https://pc.0g.ai/models)、[Router 文档](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/quickstart)。模型 ID 不能直接用展示名代替。

## 模型比较

模板已配置比较候选 `glm-5.3,claude-sonnet-5`，这两个准确 ID 已通过公开模型目录核验。运行 `npm run compare-models -- --help` 查看实际参数。同一项目、同一资料比较不同模型；比较会消耗 0G 余额。以来源忠实度、源码理解、中文可读性和结构稳定性选模型，不只依据目录介绍。比较报告保存在被忽略的 `artifacts/` 中。尚未取得 Key 时不能宣称完成模型比较。

## 检查

```bash
npm run typecheck
npx tsc --noEmit
npx eslint . --quiet
npm run build
```

按需求未新增自动化测试。数据库幂等、模型生成和线上定时执行需要在真实配置下分别验证；编译通过不能代替这些验证。

## 部署

1. 建立 Neon 免费项目，把连接写入本地 `DATABASE_URL`，执行迁移。
2. 将项目提交到自己的 GitHub 仓库。私有仓库的 Actions 运行消耗账号包含额度，超额不会被当作无限免费。
3. 在仓库 Settings → Secrets and variables → Actions 添加 `DATABASE_URL`、`ZERO_G_API_KEY`、`ZERO_G_MODEL`。工作流使用 GitHub 内置只读 `GITHUB_TOKEN`。
4. 在 Vercel 个人空间导入仓库，框架选择 Next.js。网站环境变量仅需要 `DATABASE_URL`，可加 `NEXT_PUBLIC_SITE_URL`；AI Key 留在 Actions Secrets 中即可。
5. 配置 Vercel Production 为公开访问。不要把默认预览部署的访问保护状态当作正式站点的公开状态。
6. 手动运行 Collect 工作流，检查完成状态、任务统计和网站真实数据。之后观察至少一次真实 schedule 触发。

定时任务定义在 `.github/workflows/collect.yml`，以 UTC 编排。GitHub 的定时任务可能延迟，不承诺准点；公开仓库长期无活动也可能停用定时任务，需检查 Actions。页面展示最近有效更新时间以便识别停更。

网站请求不执行迁移或触发模型生成。部署网页不等于后台已配置、生成成功或定时触发成功。

## 数据与学习边界

- 默认发现累计 Star ≥1,000，或近 90 天创建且 Star ≥100 的项目；不限制技术方向。
- 默认排除 fork、归档、禁用、空仓库。官方搜索存在分页和速率限制，不能保证扫描全 GitHub。
- 首次发现以最新正式 Release 为背景基线；后续正式 Release 产生新事件。普通推送时间和版本发布时间分别展示。
- Star 增长来自实际每日快照，基线不足时为未知，不补零或假设七日收益。
- 解读读取固定 revision 的资料，不执行第三方项目代码；来源不足时明确说明。
- 结构校验无法证明所有事实正确。具体安装命令、性能和兼容性应回到所附官方来源核对。
- 收藏以仓库 ID 保存，已读以事件 ID 保存。换浏览器或清除浏览器数据前，可在收藏页导出记录，再导入恢复。

设计与实施记录位于 `docs/superpowers/`。
