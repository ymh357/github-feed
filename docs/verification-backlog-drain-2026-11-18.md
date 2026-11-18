# 首发积压持续处理与页面更新核验

日期：2026-11-18。用户指出“可阅读数字没变”，继续原修复任务。

## 原因核实

- 服务端POST /api/catalog与新取首页均为可读216、pending358、processing0；前一轮只完成9篇发布验收，成功水位又进入3小时等待，未持续消化首发积压。
- 随后实际绑定用户已打开的IAB标签页，AX明确仍显示207/250和11月18日15:35旧状态。服务器数据与长时间打开的客户端快照同时存在差异，单查服务器不足以否认客户端未更新。
- 不通过调计数、恢复次数或把旧文刷新当新文章来增加可读量。

## 修复范围

- 工作流精确关联本GitHub run/attempt的已结束全局生成结果；仅真正首次发布>0、无基础故障且仍有可领取首发积压时，单次dispatch后继generate/both/200，depth0..11最多12个job。
- 定向/深入专批、零首发、仅刷新、未来退避、source/耗尽/活跃processing均不续跑；网络结果不明不重发。增加最小Actions write，官方queue:max避免普通单pending替换。
- collector保存GitHub run/attempt、首次发布数和基础故障标志；保存成功且原无文章才计首次发布，所有scope更新保留发现范围。
- scheduler有可领取首发且上一批正常有产出则立即到期；失败仍45分钟退避，infra=true不作为成功完成水位。租约继续阻止重入。
- 页面可见时每30秒更新；公共列表router.refresh保留位置和筛选，个人列表只用当前POST筛选、不把私有ID放URL。隐藏停止，回前台立即更新；刷新失败保留同筛选成功快照。运行中不输出未结算0，历史未知首次发布数显示未知而非补0。

## 已完成检查

- 类型检查、ESLint和生产构建通过；没有新增依赖或测试文件。
- 续跑inline覆盖全部停止条件、run/attempt隔离、depth10→11/11停止、单POST及网络错误不重发；旧run缺新元数据只读安全停止。
- scheduler inline覆盖积压立即到期、无积压保持3小时、失败45分钟、租约阻挡；复审修复partial有产出但infra=true的旁路。
- 独立复审未发现未解决P1/P2。
- 已启动旧头真实批量任务44297470668，实查API从216增加至257且processing1，确认增长来自发布而不是展示口径修改。此旧workflow没有新续跑步骤，后续链路必须另做新头实跑验证。

## 云端与页面验收

- 旧头真实批量44297470668结束：generated53、failed1、partial（达到有界预算），可读216→269。没有用恢复入队或前端加数代替发布。
- 新头0dbd33b实际run [44299903702](https://github.com/ymh357/github-feed/actions/runs/44299903702)：业务250e8e48-dc5d-4175-9e3c-9420971a5dad，completed、generated4、failed0、generatedFirstPublications4、infrastructureFailure=false；精确githubRunId和attempt1已入库。
- 该run的continuation检查实际输出matchedRuns1、firstPublications4、claimable227、proceed=true、nextDepth1，单次请求下一批。真实自动后继[44300106552](https://github.com/ymh357/github-feed/actions/runs/44300106552)由github-actions[bot]创建，已in_progress并持续实际发布；不是根代理再次手动触发。
- 生产部署dpl_FmQzFGFje1BuskGr8AtFAB6iMfTn READY并绑定正式域名；本地及远端构建、类型、ESLint、独立复审通过。workflow的queue:max与actions:write已由真实新run成功接受。
- 实际IAB用户标签页：初读207；仅reload一次载入新版后269、visibility=visible；之后没有再reload/导航，第二次读到274且显示“正在生成学习解读”，证明30秒轮询真实更新。运行中的生成/失败计数隐藏，顶层可读数实时展示。
- 同期服务端API又确认ready275、processing2，与持续产出一致；后继仍在运行，不把未完成积压写成已清空。旧scope无精确首发计数保持null，新结束run才显示首发计数。
- 后继链仍受12job边界、claimable队列、基础故障和零首发停止条件保护；如果派生触发丢失，下次实际cron唤醒会因首发积压即时到期，不再等3小时。
