# XiaoBa 项目推广计划书

版本：2026-05 草案  
目标：围绕 GitHub stars 增长做一次可执行的开源发布战役，同时沉淀长期开发者分发渠道。

## 1. 项目定位

XiaoBa 是一个本地优先的 AI 角色 runtime。它不是单纯的终端聊天壳，而是让 AI 角色长期活在 IM、CLI、Dashboard、桌宠和本地项目环境里，能接收聊天里的任务、调用工具、调度 Codex / Claude Code / AutoDev 等外部 coding agent，并把结果以消息或文件形式交付回去。

对外一句话：

> XiaoBa is a local-first, message-native AI role runtime that lets long-lived AI roles work from chats, files, tools, and coding agents.

中文一句话：

> XiaoBa 把一次性的 AI 助手，变成可以长期活在聊天和本地环境里的 AI 角色 runtime。

首轮推广不要把故事讲成“又一个 AI CLI”。更有传播力的角度是：

- IM-native agent：真实工作往往从聊天开始，而不是从终端开始。
- Role runtime：工程师、审查员、督察员、研究员等角色有不同工具边界和交付口径。
- Local-first：围绕本地电脑、文件、项目、日志、记忆和用户习惯生长。
- Coding-agent orchestration：不替代 Codex / Claude Code，而是把它们当成可调度、可验收、可回报的能力。

## 2. 当前仓库转化诊断

已通过 GitHub API 核对：`fightheyyy/XiaoBa-CLI` 当前 stars 为 0，repository description 为空，topics 为空。README 已经有中英文版本、banner、核心能力和 quickstart，这很好，但推广前还需要补齐“流量承接层”。

发布前必须完成：

- 设置 GitHub About description：`Local-first, message-native AI role runtime for chats, tools, coding agents, and desktop workflows.`
- 添加 topics，建议不超过 20 个：
  `ai-agent`, `agent-runtime`, `cli`, `typescript`, `electron`, `local-first`, `developer-tools`, `coding-agent`, `chatbot`, `feishu`, `weixin`, `openai`, `anthropic`, `claude-code`, `codex`, `skills`, `desktop-pet`, `workflow-automation`, `llm`, `open-source`
- 补 GitHub social preview 图片，优先使用 `assets/banner.png` 或专门裁一张 1280x640。
- 开启 Discussions，用于承接“怎么用 / 未来路线 / role 想法”。
- 准备 `v0.2.0-public-launch` 或类似 release，包含 release notes、已知限制、安装方式、截图 / GIF。
- README 首屏增加更直接的 star 转化语句，但不要乞求式表达，例如：`Star the repo to follow XiaoBa's IM-native agent runtime experiments.`
- 补 3 个 `good first issue`：一个文档类、一个 adapter 类、一个 role / skill 示例类，让新关注者能立刻参与。

## 3. 目标与 KPI

首轮目标按“真实开发者认可”来定，不买星、不互换星、不刷量。

| 周期 | 保守目标 | 主目标 | 冲刺目标 |
| --- | ---: | ---: | ---: |
| 发布后 24 小时 | 20 stars | 80 stars | 200 stars |
| 发布后 7 天 | 50 stars | 150 stars | 500 stars |
| 发布后 30 天 | 120 stars | 300 stars | 1,000 stars |

需要同时跟踪：

- GitHub stars / forks / watchers / issues / discussions。
- GitHub Insights：views、unique visitors、clones。
- 各平台点击、评论、收藏、转发。
- README 转化率：`stars / GitHub unique visitors`。
- 真实使用信号：安装成功反馈、issue、PR、微信群 / Discord 讨论、二创文章或视频。

## 4. 平台优先级：哪里最快获得 stars

结论先行：

1. **Hacker News Show HN**：最快的全球开发者 stars 爆发渠道，高波动、高上限。只适合在项目可运行、你能在线答疑时发布。
2. **V2EX 分享创造 / 程序员 / GitHub / AI 节点**：最快的中文开发者反馈和 stars 渠道，适合先验证叙事。
3. **X / Twitter + LinkedIn 技术圈**：需要靠个人账号和 KOL 转发放大，适合做连续 build-in-public。
4. **Product Hunt**：适合 AI Agents、Developer Tools、Productivity 叙事，能带来早期用户和评论，但 GitHub star 转化依赖页面设计。
5. **Reddit 定向社区**：如果选对 subreddit，转化不错；如果像广告，会被删或反噬。
6. **HelloGitHub / Awesome lists / GitHub 中文社区 / OSCHINA / Gitee 推荐**：不是最快，但长尾质量高，适合作为 launch 后第二波。
7. **掘金、SegmentFault、知乎、DEV、Hashnode、Medium**：文章型渠道，速度一般，但能解释复杂项目，适合承接搜索和二次传播。
8. **B 站 / YouTube / 小红书 / 微信公众号**：视频展示更适合 XiaoBa 的“角色活在环境里”这个故事，适合做长期内容资产。

### 平台评分

| 平台 | 速度 | 目标匹配 | Star 转化 | 难度 | 建议打法 |
| --- | ---: | ---: | ---: | ---: | --- |
| Hacker News Show HN | 5 | 5 | 5 | 4 | 英文技术叙事，强调可运行 demo 和为什么做 |
| V2EX | 5 | 5 | 4 | 2 | 中文真实故事，少营销，多请大家拍砖 |
| X / Twitter | 4 | 4 | 4 | 3 | 线程 + GIF + 技术人转发，连续 7 天 |
| Product Hunt | 4 | 4 | 3 | 4 | 做 launch page、视频、首评，GitHub 链接要醒目 |
| Reddit | 3 | 4 | 4 | 4 | 只投允许项目分享的社区，帖子本身必须有价值 |
| HelloGitHub | 2 | 5 | 4 | 3 | 自荐，突出入门友好和有趣 |
| Awesome lists | 2 | 5 | 4 | 3 | 向 AI agents / CLI / devtools 相关清单提 PR |
| 掘金 / SegmentFault / 知乎 | 3 | 4 | 3 | 2 | 技术长文，讲架构和踩坑 |
| B 站 / YouTube | 2 | 4 | 3 | 4 | 60-180 秒真实工作流 demo |
| OSCHINA / Gitee | 2 | 3 | 2 | 3 | 若同步 Gitee 镜像，争取平台推荐 |

## 5. 平台打法

### 5.1 Hacker News

目标：争取 HN 首页或 Show HN 页曝光，带来第一波全球 stars。

发布条件：

- 新用户能在 3-5 分钟内跑起来，至少 CLI chat 路径稳定。
- README 英文首屏清晰，安装指令短。
- 准备好 1 个 GIF 或短视频链接，最好展示“聊天任务 -> 工具 / agent -> 结果回传”。
- 作者发布后 6 小时内在线回复评论。

推荐标题：

`Show HN: XiaoBa – local-first AI roles that live in chats and call coding agents`

正文首评结构：

- 我为什么做：工作从 IM 开始，但 coding agent 多数活在终端 / IDE。
- 它现在能做什么：CLI、Feishu、Weixin、Dashboard、roles、skills、subagents。
- 它不是什么：不是替代 Codex / Claude Code，而是 message-native runtime。
- 我想要的反馈：安装是否顺、role 设计是否合理、哪些 IM / 工具最值得接。

注意：

- 不要让朋友去顶帖，不要请求 upvote。
- 标题不要写 best / amazing / revolutionary。
- 如果项目还不能让别人试用，不要发 Show HN，改发普通技术文章。

### 5.2 Product Hunt

目标：触达早期产品人、AI agent 用户和开发工具爱好者，获得评论和外链。

准备内容：

- Tagline：`Local-first AI roles for chats, tools, and coding agents.`
- Gallery：banner、Dashboard 截图、角色图、架构图、60 秒 demo。
- Maker comment：讲清楚“聊天入口 + 本地 runtime + 角色 + coding agent orchestration”。
- GitHub 链接放在页面和首评中，明确开源。

节奏：

- 提前 7 天完成账号、素材、首评和 supporter list。
- Launch 时间按 Product Hunt 官方建议，若能提前规划，选择 12:01 am Pacific Time。
- 当天只邀请大家“看看、评论、反馈”，不要直接索要 upvote。

Product Hunt 更像“发布会”，不是单纯拉 stars。GitHub star CTA 要放在 landing / README 首屏，否则 Product Hunt 流量会转化成一次性浏览。

### 5.3 V2EX

目标：中文开发者快速反馈、第一波 stars、找到真实使用场景。

推荐节点：

- `分享创造`：首发主贴。
- `程序员`：若主题偏工程工作流。
- `GitHub`：如果讨论重点是开源项目本身。
- `AI` / `OpenAI` / `Claude` / `GitHub Copilot`：如果主题偏 agent runtime 和 coding agent。

推荐标题：

`[开源] 做了一个本地优先的 AI 角色 runtime：让 agent 活在聊天、工具和本地项目里`

正文结构：

- 一句话说清楚：不是终端聊天壳，而是 IM-native AI role runtime。
- 讲一个真实场景：群里有人丢 bug / 文件 / 需求，XiaoBa 接住、调 coding agent、回群交付。
- 列当前能力：CLI、飞书、微信、Dashboard、桌宠、roles、skills、subagents。
- 坦诚状态：早期项目，源码运行优先，欢迎拍砖。
- 提问引导：大家更想要哪个入口 / role / 安全边界？

不要一上来就“求 star”。可以在结尾自然写：`如果你也在折腾 IM-native agent / 本地 AI runtime，欢迎 star 关注后续实验。`

### 5.4 X / Twitter 与 LinkedIn

目标：扩大技术圈二次传播，给 HN / Product Hunt / GitHub 导流。

建议内容节奏：

- Day -3：问题型铺垫：为什么 coding agent 不应该只活在终端？
- Day -2：架构图：IM -> runtime -> roles -> skills/tools -> coding agents -> reply。
- Day -1：GIF：真实工作流 demo。
- Day 0：正式 launch thread，附 GitHub 链接。
- Day +1：发布反馈总结和 roadmap。
- Day +3：发一个技术拆解：role-aware tools / skills / subagents。
- Day +7：发第一周数据复盘。

线程 hook：

`I built XiaoBa because most AI coding tools start in terminals, while real work starts in chats. XiaoBa is a local-first AI role runtime that can live in IM, call tools and coding agents, and report back.`

### 5.5 Reddit

目标：在英语开发者小圈层拿到高质量反馈。

候选社区：

- `r/opensource`
- `r/commandline`
- `r/selfhosted`，如果强调本地优先和自托管。
- `r/LocalLLaMA`，如果能展示本地模型或 open model 配置。
- `r/SideProject`
- `r/programming`，仅在有高质量技术文章时尝试。

发帖原则：

- 先读每个 subreddit 的规则，很多社区限制自我推广。
- 帖子本身要能独立提供价值，不要只扔链接。
- 标题用“我做了什么 / 为什么做 / 学到了什么”，少用营销词。
- 准备英文长评论，解释架构和安全边界。

推荐标题：

`I built a local-first AI role runtime that can live in chats and dispatch coding agents`

### 5.6 HelloGitHub、Awesome Lists、GitHub 中文社区

目标：获得长期中文开源分发和持续 stars。

动作：

- 向 HelloGitHub 自荐，突出“有趣、入门友好、AI agent、TypeScript、IM 工作流”。
- 给相关 awesome lists 提 PR：AI agents、developer tools、CLI、LLM tools、automation、local-first apps。
- 向 GitHub 中文社区、Wechat-ggGitHub / Awesome-GitHub-Repo 等项目推荐。

准备材料：

- 150 字中文简介。
- 80 字英文简介。
- 一张 banner。
- GitHub 链接。
- 3 个亮点。
- 1 个“适合新手试用”的 quickstart。

### 5.7 掘金、SegmentFault、知乎、DEV、Hashnode、Medium

目标：把复杂项目讲透，积累搜索和技术信誉。

首批文章选题：

- `我为什么做一个 IM-native AI role runtime，而不是再做一个 CLI 聊天壳`
- `XiaoBa 架构拆解：Roles、Skills、Tools、Subagents 如何协作`
- `让 AI agent 从聊天里接任务：Feishu / Weixin adapter 的设计取舍`
- `从一次性助手到长期角色：AI role runtime 的安全边界和记忆设计`

中文文章投掘金、SegmentFault、知乎专栏；英文文章投 DEV、Hashnode、Medium。文章里 GitHub 链接出现 2-3 次即可，不要堆叠。

### 5.8 B 站 / YouTube

目标：把“活在聊天和桌面环境里”的体验可视化。

最小视频脚本：

1. 5 秒：群聊里有人丢任务。
2. 10 秒：XiaoBa 识别任务和角色。
3. 20 秒：调用工具 / coding agent 后台执行。
4. 15 秒：Dashboard 或日志展示过程。
5. 10 秒：结果回到聊天或文件交付。
6. 5 秒：开源地址和 quickstart。

标题：

- 中文：`我做了一个能活在聊天里的 AI 工程师角色 runtime`
- 英文：`I built a local-first AI role runtime for chats and coding agents`

## 6. 首轮发布节奏

### 第 0 阶段：发布前 2-3 天

- 完成 GitHub About、topics、social preview、Discussions。
- 准备 release、demo GIF、截图、视频。
- README 首屏加入更明确的 positioning 和 star-follow CTA。
- 新建 3 个 good first issues。
- 建一个简单 tracking 表：平台、发布时间、链接、UV、stars 增量、评论数、后续动作。

### 第 1 阶段：中文开发者验证，Day 1-2

- V2EX `分享创造` 首发，争取真实反馈。
- 掘金发一篇技术长文，知乎同步。
- 微信群 / 朋友圈只发“项目介绍 + 请求反馈”，不要群发求 star。
- 收集 10 条真实问题，优先修 README 和 quickstart。

### 第 2 阶段：全球技术社区，Day 3-5

- Hacker News Show HN。
- X / LinkedIn 英文 launch thread。
- DEV / Hashnode 发布英文架构文章。
- 视情况投 Reddit，避免同一天多社区复制粘贴。

### 第 3 阶段：产品社区，Day 6-10

- Product Hunt launch。
- 发布 60 秒 demo 视频。
- 汇总 HN / V2EX / Product Hunt 评论，开 public roadmap issue。

### 第 4 阶段：长尾渠道，Day 11-30

- HelloGitHub 自荐。
- Awesome lists PR。
- OSCHINA / Gitee 推荐，前提是同步 Gitee 镜像并补中文说明。
- 每周发一次 changelog：新 role、新 adapter、新 demo、新 contributor。

## 7. 内容素材包

### 7.1 150 字中文简介

XiaoBa 是一个本地优先的 AI 角色 runtime。它让 AI 角色不只活在终端或 IDE，而是可以从 CLI、飞书、微信、Dashboard、桌宠等入口接收任务，理解聊天和文件上下文，调用本地工具或 Codex / Claude Code 等 coding agent 后台工作，并把结果以消息或文件形式交付回来。当前内置工程师、审查员、督察员、研究员等角色，支持 skills、tools、subagents 和日志回放。

### 7.2 80 字英文简介

XiaoBa is a local-first, message-native AI role runtime. It lets long-lived AI roles work from chats, files, local tools, and coding agents, then report results back through the same conversation surface.

### 7.3 三个卖点

- Chat-native：工作从 IM 和文件开始，XiaoBa 让 agent 能在这些入口接任务。
- Role-aware：不同角色有不同 prompt、tools、skills 和职责边界。
- Agent orchestration：把 Codex、Claude Code、AutoDev 等外部 agent 当作可调度、可验收、可汇报的能力。

### 7.4 发布帖结尾 CTA

中文：

> 如果你也在做 AI agent、IM 工作流、本地优先工具或 coding agent 编排，欢迎试跑一下。项目还早期，最需要的是真实反馈；觉得方向有意思也可以 star 关注后续实验。

英文：

> If you are exploring AI agents, local-first tools, IM workflows, or coding-agent orchestration, I would love your feedback. The project is early, but the runtime is already runnable from source.

## 8. 仓库转化优化清单

- README 首屏 10 秒内回答：是什么、解决什么问题、如何运行。
- Quickstart 保持最短路径，不要让新用户先读一堆概念。
- 每个核心能力配一个具体场景，不只列名词。
- Release 页面提供“推荐试用路径”。
- Issues 模板增加 `bug`, `feature`, `role idea`, `adapter request`。
- CONTRIBUTING 说明如何新增 role / skill / adapter。
- Roadmap issue 置顶，让 star 用户知道项目会往哪里走。
- 添加 Star History 图，但放在 README 后半部分，不要压住 quickstart。

## 9. 风险边界

- 不买 stars。假星短期可能提高数字，但会损害长期信任，也容易被识别为异常增长。
- 不在 HN / Product Hunt / Reddit 请求 upvote。可以请求阅读、试用、评论、反馈。
- 不跨多个 Reddit 社区复制同一段广告文。
- 不夸大功能成熟度。明确“源码运行优先”“桌面 release 准备中”之类的状态。
- 不把所有流量同时打出去。先用 V2EX / 小范围技术圈修正叙事，再打 HN 和 Product Hunt。
- 对安全边界保持透明：本地文件、shell、外部 agent、IM 消息权限都要说明清楚。

## 10. 推荐执行顺序

如果只做一周，优先级如下：

1. 修 GitHub 元信息、topics、social preview、Discussions。
2. 做一个 60 秒 demo GIF / 视频。
3. 发 V2EX，收反馈，修 README 和 quickstart。
4. 发 HN Show HN，全程在线回复。
5. 发 X / LinkedIn 英文 thread，请技术朋友转发“反馈”，不是转发“求 star”。
6. 递交 HelloGitHub 和 3-5 个 awesome lists。
7. 准备 Product Hunt，在素材更完整时发第二波。

## 11. 参考资料

- GitHub Docs：repository topics 可帮助用户发现相关仓库，且单仓库最多 20 个 topics。https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics
- Hacker News Guidelines：HN 鼓励技术好奇心，反对标题党和索要投票。https://news.ycombinator.com/newsguidelines.html
- Show HN Guidelines：Show HN 适合可试用、作者亲自参与讨论的项目。https://news.ycombinator.com/showhn.html
- Product Hunt Launch Guide：官方建议准备 launch 素材，且不能直接要求别人 upvote。https://www.producthunt.com/launch
- Product Hunt 分类页面包含 Engineering & Development、LLMs、Productivity、AI Agents 等与 XiaoBa 匹配的分类。https://www.producthunt.com/launch
- V2EX 分享创造节点：适合发布个人创造、开源项目和早期产品。https://www.v2ex.com/go/create
- HelloGitHub：中文开源项目推荐平台，可推荐或自荐项目。https://github.com/521xueweihan/HelloGitHub
- OSCHINA 运营源计划：OSCHINA / Gitee 对托管在 Gitee 的开源项目有社区曝光机制。https://www.oschina.net/help-center/oschina-guides/how-to-play-in-osc.html
- arXiv: Launch-Day Diffusion，2025 年对 138 个 AI / LLM 工具 HN 曝光的分析显示，HN 曝光后 stars 增长具有明显 launch effect。https://arxiv.org/abs/2511.04453
- arXiv: How do Developers Promote Open Source Projects，研究指出 Twitter、用户会议、博客、Hacker News 等是常见开源推广渠道。https://arxiv.org/abs/1908.04219
- arXiv: Six Million Suspected Fake Stars，研究提示假星会损害 GitHub stars 的可信度，并可能成为长期负担。https://arxiv.org/abs/2412.13459
