# 热点发现与正式准入验证

日期：2026-11-05（Asia/Shanghai）。用户授权修复REA漏收与cinepulse低星误收。

## 原因与规则

- cinepulse为Android视频播放客户端，核验时7Star，命中旧近30天/5Star渠道；此前没有独立准入关卡，云端生成验证样本进入了正式库。
- REA创建于2026-04-14，既不在90天新项目窗口，也不匹配当天2022年历史分片；核验时实时官方日/周榜均未出现，但全站Star第5、近期活跃热门第3。因此新增不受创建年限制的固定热门头部。
- 统一正式门槛>=1000Star，以下仅候选。门槛是可解释关注度基础，不是代码质量认证；不执行第三方代码，不额外引入模型质量评分。
- 官方日/周榜实时HTML有界2MB/25秒，不带API凭据；h2仓库路径经GitHub API核验。降级、局部失败、未扫描范围均记录。
- 小limit保留其他渠道机会；历史页最后按剩余预算完整读取。游标确认项目必要数据持久化，不因独立Release/公告失败卡住。

## 已执行

- 幂等schema迁移36语句连续两次成功。候选不删除历史文章/事件/浏览器记录。
- 实库cinepulse=7Star、candidate、inactive，正式搜索0条；直链详情仍能访问历史文章且返回candidate，相关项目/语言/健康/模型队列一致过滤。
- 另一个194Star模板项目同样隔离。候选可继续元数据轮转，达到门槛后重新核验升格。
- 真实只读discover20返回20个正式项目，全都>=1000；REA自然入选，channels为github-popular/github-active-popular，未写名称特例。
- 正式discover20实际入库REA，观察值432857Star、eligible、active，渠道已持久化；早期候选独立保存，不占正式名额/不调用模型。
- 该次run 77585907-b020-4a6b-bf1a-7c7514c1bf46：discovered16、generated0、failed1、partial。openclaw的Release响应触发原4MB上限，项目元数据已保存；没有放宽大小限制。随后分离游标与Release失败的因果并复审。
- 无网络游标验证连续2页无跳项/重复前缀；Release失败但元数据保存时推进，元数据数据库失败不推进并非零退出。
- 无网络候选拦截验证：7/999Star的generateLearning零fetch；compare候选仅GitHub元数据请求，零模型目录/付费请求；1000Star可进入正常路径。
- npx tsc --noEmit、npx eslint . --quiet、npm run build 通过；未新增依赖或测试文件。
- 独立审查已确认候选旁路、游标因果、小limit配额修复，无未解决确定P1/P2。

## 最终上线

- REA真实生成与事实复核完成，run 68bc2615-08d4-4c0b-949d-6ef9db5a79a1，generated1/failed0。正式详情 https://github-feed-nine.vercel.app/projects/1209966933 已可读What/Why/How并显示实际发现渠道；未执行REA代码或安装软件。
- 正式生产部署 dpl_7eAXYbGd9rK4UCoynewoBo6oQSX7，READY。线上API搜索REA返回1条ready/eligible；cinepulse返回0；默认列表不存在低于1000Star项目。
- 云端新版发现 https://github.com/ymh357/github-feed/actions/runs/42030432204 执行结束。业务run 106c5f68-865d-404d-8793-031f207c72b8 为partial：openclaw版本响应仍触发4MB上限，其余项目元数据已保存；archive-formal-2022:size-4实际推进至page2（20:50:40北京时间）。证实单项版本错误不再卡住已保存发现进度，未把partial说成全部同步成功。
- 页面候选标识、准入依据及渠道记录已上线；截图保存在忽略目录artifacts/rea-admission-production.png。
- 源码已提交公开仓库，密钥扫描通过；无新增依赖/测试文件，无原始诊断或私有配置提交。
- Star仅作为最低关注度门槛，不能证明项目代码质量或保证全GitHub热门覆盖；Trend页面变动和API限流仍通过降级记录与后续续跑处理。
