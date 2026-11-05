# 交付与验证记录

日期：2026-11-05（Asia/Shanghai）

## 当前状态

网站已在个人 Vercel 空间部署并公开可访问，0G Key 已本地配置并完成真实推理验证。尚未创建 Git 仓库、提交或推送；每日 GitHub Actions 更新仍待仓库授权和 Secrets 配置。数据库目前仍为待认领的临时数据库。

正式地址：https://github-feed-nine.vercel.app

生产部署：dpl_8L9A6KoVvXPWqYTCtQmxQKf8Goi8，状态 READY；个人空间 Miles' projects，项目 github-feed，Next.js preset，Node.js 22.x。通过本地源码部署，没有 Git 写操作。

本地预览：http://127.0.0.1:3000

真实学习详情：http://127.0.0.1:3000/projects/1073224795

## 已执行检查

- `npm run typecheck`：通过。
- `npx tsc --noEmit`：通过。
- `npx eslint . --quiet`：通过。
- `npm run build`：通过，生成首页、项目详情、版本详情及 catalog API 路由。
- 无数据库配置的 health：明确提示未配置，并以 1 退出。
- 两个收集 CLI 的 `--help`：通过。
- 无 Key 的公开 0G 模型目录查询：通过，核验 `glm-5.3` 与 `claude-sonnet-5`，并检查格式和参数支持。
- 真实 GitHub dry-run：三路查询返回项目，记录实际分页范围，不写库或调用模型。

## 临时数据库实际检查

使用 Neon 官方匿名临时数据库，没有新增依赖或提供支付方式。到期时间为 **2026-11-08 18:20:47 北京时间**；认领操作链接保存在被忽略的 `artifacts/database-claim.md`，不应公开。

- 连续执行迁移两次，均成功：15 条幂等初始化语句。
- 首轮 `collect --discovery-only --limit 6`：新增 6 仓库、6 发现事件，无失败。
- 相同批次第二轮：新增 0，仓库与事件仍各 6，无失败。
- 首篇 `obra/superpowers` 解读根据固定 commit 的 README、index.js、package.json 由本次 Codex 会话整理，经过文章结构校验、claim 和 saveContent 保存。
- 文章的作者标识为“Codex（本次会话整理）”，没有冒充 0G 模型生成或评测结果。
- 六个仓库当前只有当日快照，Star 增长正确为 null。

## HTTP 与数据查询

- 首页、项目榜单、收藏入口、搜索入口返回 200。
- 未收录项目及版本路径返回 404。
- 真实项目详情返回 200，正文、What / Why / How 与固定 commit 来源均出现在响应中。
- 收藏查询单个项目：1 条，包含有效文章。
- 已读查询指定事件：1 条；未读查询同一记录：其余 5 条。
- 超出页码自动钳制到有效页。
- SQL 特殊字符搜索返回正常空结果，不改变查询结构。
- malformed JSON 和非法 ID 请求返回 400。
- 个人筛选 POST 传输，不将浏览器个人记录放入 URL。

## 审查

独立审查发现并修复两项 P2：失败或排除的仓库阻塞同步轮转，以及预发布版本导致正式版本抓取覆盖判断错误。复审未发现新的可明确复现的 P1/P2。

## 0G 实际调用与默认模型

- 用户提供的 Key 仅保存在权限 0600 的 `.env.local`，未显示在日志中。生产网站只配置了 DATABASE_URL，没有上传 0G Key。
- 两个候选模型的真实短推理请求均返回 HTTP 200。
- 初始两个项目的配对比较中，GLM-5.3 两次触发 240 秒超时；Sonnet 的初始输出未通过旧版 JSON 解码。原始比较报告没有保留详细失败原因，不能据此倒推全部 Sonnet 失败的具体原因。
- 针对 mattpocock/skills 另做诊断，确认 Sonnet 返回的是完整 JSON 外加 Markdown 代码围栏；剥离完整外层后全部原有字段校验通过。
- 修复仅接受完整外层代码围栏，不修补非法 JSON 或截断输出；finish_reason、文章字段与源码路径校验仍保留。解析失败原文只用于本地诊断；比较脚本新增逐案例保存和阶段日志，报告替换真实 Key 后写入 0600 的被忽略文件。
- 使用保存的真实 Sonnet 响应回放解码并入库，没有重复付费；该条未保留 token 用量，记录为 null。
- 修复后的 collect 实际批量任务新保存 3 篇，一篇被格式校验拦截，任务如实记录 partial。该篇随后在重试上限内重新生成成功，没有放宽校验。
- 当前数据库为 6 仓库、6 事件、6 ready、0 failed、0 expired leases：1 篇 Codex 会话样例、5 篇真实 0G Sonnet 解读。
- 默认模型调整为 claude-sonnet-5，依据是本轮可用性、耗时和输出抽查；这不是通用模型质量排名，也没有证明 GLM 在其他参数或环境下一定不适用。
- 定点代码复审未发现格式兼容与诊断保存逻辑新增确定 P1/P2。

## 浏览器实际验证

用户本轮操作后浏览器已可连接，补齐此前因锁屏无法执行的验证：

- 点击收藏后进入收藏列表，刷新仍保留同一项目。
- 进入详情后出现已读标记，已读筛选只返回对应事件。
- 浏览器搜索与 Star 排序可用，排序结果与真实累计 Star 一致。
- 导出 JSON 成功，导回同一文件后合并保留原记录，不重复收藏；测试收藏已手动恢复。
- 桌面与 390×844 手机尺寸检查，手机 documentWidth = viewportWidth = 390，没有横向溢出；临时 viewport override 已恢复。
- 正式 Vercel 地址已在浏览器显示真实六项目及学习解读，保留为交付页面。
- 截图保存在本地 artifacts/preview-production.jpg、preview-detail-desktop.jpg、preview-detail-mobile.jpg，没有内联 base64 文本。

## 生产 HTTP 检查

- 未登录访问正式别名首页与真实项目详情，均为 HTTP 200，无登录跳转。
- POST /api/catalog 返回 configured=true、error=false、6 条 ready 内容。
- /.env.local、/artifacts/validation-db.json、/scripts/collect.ts 均为 HTTP 404。
- 检查的网页正文中不含 API Key 或数据库连接值；本地客户端 bundle 中也未包含数据库连接。
- `.vercelignore` 排除全部环境文件、本地诊断、文档、工作流、Git 元数据和构建缓存，避免上传私密验证材料。
- 本轮修改后再次执行 npx tsc --noEmit 和 npx eslint . --quiet，通过；Vercel 生产构建成功。

## 尚未验证

- 数据库永久归属；需要用户在到期前认领或替换自己的 Neon 数据库连接。
- GitHub 私有仓库创建、提交推送、Actions Secrets 配置与真实 schedule 触发。
- 正式版本新事件的跨日线上跟踪、成熟 Star 增长区间；目前仍只有当日快照。
- 当前没有新增自动化测试，遵循用户约束。

当前网站已上线；每日持续更新尚未启用，临时数据库的可用性有到期边界。
