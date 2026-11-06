# 解读生成恢复与状态修复

日期：2026-11-06（Asia/Shanghai），用户授权修复“待整理94”。

## 根因

- 现场待整理94项：47个项目介绍、47条版本动态，0项已有文章刷新；处理中0、可读13。
- 2026-11-06北京时间04:15与09:48的自然定时生成分别在模型预检失败：42101597003、42146167004。发现/同步仍在新增任务。
- 0G当前/models仍存在claude-sonnet-5且支持OpenAI文本，但supported_parameters未声明max_tokens/max_completion_tokens；旧compatible将元数据未列出当作不支持，生成在startRun之前退出。
- health读取最新任意任务，后续sync/discover完成掩盖了生成中断；没有实际生成任务记录可显示。

## 修复

- 兼容判断要求模型存在、文本类型及OpenAI格式；每次请求仍必须发送正整数输出上限。明确仅列max_completion_tokens时用它，否则发送标准max_tokens，包括目录参数缺漏情况。
- 不移除输出上限重发，不接受截断输出，不放宽字段/引用/事实复核。
- 任务先startRun再进行Key/模型预检，失败进入相同catch并finishRun failed，退出非零；预检失败不消耗内容attempt。
- scope显式记录generatesContent，避免discovery-only任务混入生成健康统计。
- health独立识别最近生成任务，显示失败原因、时间、实际生成数量；最近产出来自实际文章generated_at，generated0不刷新成功产出。
- 待整理以项目介绍/版本文档动态/旧文更新拆分，深入更新单列子集；同步完成不会覆盖生成失败。

## 已验证

- 真实Sonnet5长序列探测：max_tokens32、reasoning_effort low，HTTP200、finish_reason=length、completion_tokens32，确认当前接口仍遵守输出上限。未改模型或密钥。
- 无网络参数分支验证：max_tokens、completion-only、双声明、元数据缺漏均包含cap；非文本/无OpenAI格式仍拒绝；HTTP400只有一次请求，不去掉cap重发。
- 受控临时空Key子进程验证：退出1，任务e12c1a3b-7a8a-4367-804a-25d300e2a75c已记录failed/finished/message；全库attempts前后均17，没有付费请求。只对子进程覆盖空值，正式环境配置未改。
- health实库读取可识别该预检失败，最近实际产出仍为11月5日20:48，并准确显示47+47项待整理。
- TypeScript、ESLint初轮通过。云端恢复、实际消化数量和最终部署将在完成后补记。

不新增依赖或自动化测试文件，不修改准入标准，不删除队列或用失败状态假装产出。
