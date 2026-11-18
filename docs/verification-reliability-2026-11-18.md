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

生产部署、云端新管线和四个大响应仓库的最终续采结果在实际完成后追加；不得用本地检查代替云端运行。
