# 持续更新可靠性修复核验

日期：2026-11-18，用户授权核实并修复生成失败、积压和调度漏跑。

## 修复前核实

- 线上API与生产数据库一致：可读207、待整理250（介绍62、更新110、旧文刷新78），失败83（可重试11、耗尽70、真实/误判资料不足2）。可读包含仍有旧文的刷新/失败项目，不等于status=ready数量。
- 全部84条Actions记录与业务运行记录交叉核对：11月12–17日全局生成只有17轮，配置目标48轮；工作流active。不能从GitHub允许延迟/丢弃的说明直接断言此次漏跑原因。
- LangChain真实旧生成返回合法JSON，但changes=null。语法整理不会触发，字段校验直接失败；旧digest曾缺changes，另有事实审核不通过。
- Sonnet5严格JSON Schema真实请求返回400 model_not_capable，真实原/新版请求出现生成或审核超时；没有移除输出cap重发。
- Release每页100条使opencode/openclaw/plannotator/arcane响应超过4MB；Elasticsearch实际存在README.asciidoc但格式白名单漏掉。

## 实施

- prompt4提供按事件类型的10字段合同及允许路径，changes必须为字符串或discovery的null。至多一次来源约束修订，之后完整校验和独立事实审核。不得输出内部编排字段。
- 最多5次模型请求，阶段超时合计555秒，受总deadline约束并为最终审核保留120秒；不修订截断或基础设施失败。
- 同固定来源对照后改用gemini-3.6-flash，本地和Actions配置同步；API Key未变。网站只读取数据库，不执行推理。
- 每小时23分申请唤醒，数据库持久水位追赶generate3h/sync6h/discover24h；零产出不推进生成完成水位。阶段token租约续约、失租终止child、SIGKILL兜底及总30min预算。
- 首发内容优先；即使首发正在退避或处理中，也不追加自动旧文维护。
- Release每页10条，超限缩至5/1，不放宽JSON4MB/文件2MB限制；首次跳过预发布直到正式版本。无基线历史按raw offset跨轮续采，每轮300条，仅真实EOF原子建立基线。
- 新增修复恢复审计：唯一(content,repair_revision)，归档原status/attempts/error/retry/attempt_revision；新revision已尝试项不作为旧失败恢复。处理中的任务、旧文章和真实缺资料项保留。

## 已完成验证

- required npx tsc --noEmit、npx eslint . --quiet、npm run build通过；数据库46条语句重复迁移成功。
- 同固定来源真实完整生成与独立审核通过：Gemini major23.524s、digest15.784s、Elasticsearch介绍11.112s；样本不足以证明普遍正确。
- 三份已审核ContentWrite经当前validate、claim、save发布，正式详情HTTP200并展示Gemini模型。
- 恢复71项（70耗尽、1项已实际重新读到asciidoc的资料误判），第二次恢复0；恢复前后原article哈希一致。原始失败状态已入content_recoveries。
- claw-code暂停摘要实库只有v0.1.13一个成员，正文0字符，保持暂停；不把上海同日另一个有正文版本强行填入该不可变摘要。
- source真实固定revision读取Elasticsearch README.asciidoc10268字符，不再误判缺失。
- Scheduler inline覆盖due/backoff/busy、正常/非零退出、超时、失租、续约错误、强杀；真实dry-run只读，未申请租约或调用模型。
- Release inline覆盖预发布/草稿、空、300全预发布、缩页连续偏移、晚发布深页、API失败不推进、租约/CAS失败及重复幂等。真实只读opencode offset300→600仍正确保持未完成，不以发布日期短路。
- 独立复审发现并修复：零产出完成水位、退避首发与自动维护冲突、最新raw预发布误作无正式版、按旧发布日期错误推断完整历史。

## 发布核验

- 云端新管线实际执行成功：[Actions 44282798378](https://github.com/ymh357/github-feed/actions/runs/44282798378)，业务run `3d831948-56e3-4a2e-8a04-f16cb821d30c`，2026-11-18 18:11:20–18:12:20北京时间，generated=6、failed=0、status=completed。包括gbrain、Rust、LangChain、RuView、agent-desktop的不同事件；不只是工作流绿色。
- 加上此前三类发布验收，共新增9篇，可读207→216。线上POST /api/catalog HTTP200，generationStatus=completed/generated6/failed0，lastOutput为北京时间18:12:20。
- 当前待整理358（含恢复项和新补采更新，不是已清空），失败7中6项正常待重试、1项源说明为空暂停；耗尽attempts>=3为0、processing0。不能把入队恢复当作成功发表。
- 四个响应超限仓库真EOF核验完成：opencode901条（0→300→600→900→901）、openclaw289、plannotator231、arcane114，只有真EOF才建立正式基线。
- 中间试跑曾按被复审否决的日期覆盖逻辑写入opencode基线；已备份并仅撤回该未充分核验基线，保留全部原始事件，随后从offset0完成901条全量核对再建立基线。最终代码不保留日期覆盖分支。
- 正常同步发现Node原基线442993876当前官方标记prerelease=true；已留证条件撤回该指针，再真EOF续采535条建立正式基线448092812。没有改写历史文章或删除版本事件。
- 后续正常同步run `a6ca3f11-c076-4718-9607-62e69e343800`为partial、failed0，原因仅为Electron历史仍分批续采（offset600）；Hugo与Syncthing已在第二轮完成。存续游标优先于普通同步，实库前三优先级断言及独立复审通过。不能把未完整历史报为completed。
- 最终代码42f415f（核心77bfd89）已推送，生产部署 `dpl_9xa3AMSbweDuy6aU8NCGYs8ByZx1` 为READY并绑定github-feed-nine.vercel.app，首页接口和三份真实详情HTTP200。最终TypeScript、ESLint、本地及Vercel生产构建通过；没有新增测试文件或依赖。
- 新hourly cron已提交且工作流active，本轮云端验收使用workflow_dispatch。尚未把一次未来自然schedule唤醒当作已观察事实；追赶仍依赖GitHub实际提供唤醒，没有固定时刻或永不漏跑的保证。
