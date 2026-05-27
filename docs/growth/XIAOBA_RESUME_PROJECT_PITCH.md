# XiaoBa-CLI 简历结合版项目介绍

用途：面试自我介绍、项目深挖、简历项目讲解  
依据：`陈国伟-Agent开发(1).pdf` 与当前 XiaoBa-CLI 仓库材料

## 1. 推荐主叙事

面试里不要把 XiaoBa-CLI 讲成一个孤立的开源项目，而要讲成你在 AI Agent 实习和多个大模型项目中沉淀出来的核心 runtime 项目。

推荐定位：

> XiaoBa-CLI 是我在 AI Agent 实习期间主导/参与建设的一套 Agent Runtime 项目，主要面向企业 IM 智能助手场景。它不是单纯的聊天机器人，而是把会话管理、角色配置、工具调用、Skill 加载、subagent 调度、多平台消息接入、异常处理和可视化部署抽象成统一底座，用来支撑企业内部 AI 助手在飞书、微信等入口稳定运行。

这句话比“我做了一个 AI 助手 CLI”强很多。它直接把项目放到三个关键词上：

- 企业 IM 智能助手场景
- 统一 Agent Runtime
- 工程化稳定运行

## 2. 1 分钟面试介绍

可以这样讲：

> 我简历里最核心的项目是 XiaoBa-CLI / Agent Runtime。这个项目来自我在广东高斯做 AI Agent 实习期间的企业 IM 智能助手落地需求，当时我们需要把大模型能力接到飞书、微信这些真实办公入口里，而且不是简单自动回复，而是要支持长期会话、角色配置、工具调用、Skill 扩展、异步任务和结果回传。
>
> 我在这个项目里做的重点是把这些能力抽象成统一的 Agent Runtime：底层用 TypeScript、Node.js 和 Electron 实现，核心包括 AgentSession、ConversationRunner、ToolManager、Role/Skill 机制、subagent 调度和消息入口适配。项目已经在 3 家合作企业做过小规模部署，覆盖大概 30-60 名内部用户。
>
> 这个项目对我最大的价值是让我意识到，大模型应用真正难的不是调一次 API，而是把不稳定的模型放进可控的工程系统里。比如工具调用要有闭环，429/5xx 要能重试或 fallback，长任务不能阻塞主会话，消息和文件交付要能回到原 IM 会话，运行过程要有日志和后续评测依据。所以我做 XiaoBa 时关注的是 agent harness 和 runtime，而不是单纯 prompt 或 UI。

## 3. 2 分钟完整介绍

如果面试官让你展开，可以讲这一版：

> XiaoBa-CLI 是一个面向企业 IM 智能助手场景的 Agent Runtime 项目，也是我简历里 Agent 开发经历的主线项目。它的背景是，企业内部很多任务并不是从 IDE 或终端开始，而是从飞书、微信、群聊消息、文件和业务人员的自然语言需求开始。所以我们希望做一个可以活在 IM 里的 AI 同事，让它能够接收消息、理解任务、调用工具、执行异步任务，并把结果回传到原来的会话里。
>
> 这个项目的核心不是 chatbot，而是 runtime。它把会话管理、角色配置、工具调用、Skill 加载、消息路由和后台任务调度抽象成统一底座。比如同一套 AgentSession 可以承接 CLI、飞书和微信；Role/Skill 机制可以按企业场景加载不同的垂直行业能力；ToolManager 负责工具调用和异常归一化；subagent 模块负责把长任务从主会话里隔离出去，维护 running、completed、failed、stopped 等状态，并支持进度查询、异步执行和完成后结果回注主会话。
>
> 我在项目里比较关键的工作包括：第一，搭建 Role/Skill 扩展体系，基于 SKILL.md 和 frontmatter 做 Skill 注册、发现、按角色动态加载和自动匹配，并围绕企业需求沉淀了 20 多个垂直行业 Skills；第二，打通飞书、微信消息入口，统一用户/群组维度的会话隔离、过期清理和消息路由，降低多平台机器人接入成本；第三，补充 Agent 调用链路的异常处理机制，包括 429/5xx 可重试错误识别、指数退避、主备模型 fallback 和错误日志记录，提高 IM 场景下 Agent 服务稳定性；第四，设计 Agent2Agent 协作链路，通过 HTTP Bridge 支持群聊消息广播、异步结果回传和主 Agent 协同；第五，用 Electron 封装桌面端和 Dashboard，支持机器人服务管理、运行状态查看和本地化部署。
>
> 这段经历和我另外两个项目也有关。GauzMem 让我对长期记忆、知识图谱、向量检索和多跳推理有经验；Vibe Writing Platform 让我做过主对话 Agent、Planner、Executor、Review、Editor 这种多 Agent 文档生成流程。XiaoBa 则更像是把这些能力放到底座层：它不只关心一次回答，而是关心一个 Agent 如何在真实企业环境里长期、稳定、可扩展地工作。

## 4. 和简历能力的对应关系

| 简历经历 | XiaoBa 里怎么体现 |
| --- | --- |
| AI Agent 实习，参与 Agent Runtime、长期记忆系统、Vibe Writing Platform | XiaoBa 是 Agent Runtime 主线，GauzMem 和 Vibe Writing 是记忆与多 Agent 流程经验的补充证据 |
| 企业 IM 智能助手落地，服务生物医药、教育、工程咨询等行业 | XiaoBa 面向企业 IM 入口，不是个人玩具项目，有真实业务部署背景 |
| 3 家合作企业小规模部署，30-60 名内部用户 | 可以证明项目不只是本地 demo，而是经过真实用户和企业环境验证 |
| subagent 任务调度模块 | 体现你理解长任务、异步执行、状态管理和主会话控制平面 |
| Role/Skill 扩展体系，20+ 垂直行业 Skills | 体现你不是只写 prompt，而是把能力做成可注册、可发现、可加载的扩展机制 |
| 飞书、微信入口 | 体现多平台消息接入、会话隔离、消息路由和工程集成能力 |
| 429/5xx、指数退避、主备模型 fallback、错误日志 | 体现你知道 LLM 应用不稳定，能用工程手段提高服务稳定性 |
| Agent2Agent + HTTP Bridge | 体现多 Agent 协作、异步结果回传、群聊广播和主从 Agent 协同 |
| Electron + Dashboard | 体现你能把 runtime 包装成可运行、可管理、可部署的桌面工具 |
| GauzMem 长期记忆系统 | 可以解释 XiaoBa 后续为什么重视 session、memory、trace 和长期上下文 |
| Vibe Writing 多 Agent 文档平台 | 可以解释你对 Planner / Executor / Review / Editor 这类角色化协作有实践经验 |

## 5. 核心技术亮点

### 5.1 统一 Agent Runtime，而不是单平台机器人

可以这样讲：

> 我没有给飞书、微信各写一套机器人逻辑，而是把它们收敛到统一 Agent Runtime。平台层只负责消息解析、鉴权、文件处理和 callback，真正的会话状态、角色加载、工具调用和任务调度都交给 runtime。这可以降低多平台接入成本，也避免后续每个平台重复维护一套 agent loop。

### 5.2 subagent 调度解决长任务阻塞

可以这样讲：

> 企业 IM 场景里，很多任务不是几秒钟就结束。主会话如果同步阻塞，用户就没法继续问进度、补充信息或停止任务。所以我做了 subagent 调度，把主会话作为控制平面，子任务作为执行平面。subagent 有独立 session，维护 running、completed、failed、stopped 状态，记录进度和产物，完成后再把结果回注到主会话。

### 5.3 Role/Skill 让能力可扩展

可以这样讲：

> 我把不同企业场景里的能力沉淀成 Role/Skill，而不是全塞进一个 prompt。Skill 基于 SKILL.md 和 frontmatter 做注册、发现、按角色动态加载和自动匹配，这样可以围绕不同行业沉淀垂直能力，也方便后续增删和复用。

### 5.4 稳定性来自 harness，不是来自模型本身

可以这样讲：

> 大模型结果本身不稳定，所以 XiaoBa 不能只靠 prompt。项目里做了调用链路异常处理，比如 429/5xx 识别、指数退避、主备模型 fallback、错误日志记录；同时 ToolManager、SessionTurnLogger、subagent 状态机也会把关键动作和结果记录下来。我的理解是，大模型应用的稳定性不是让每次 token 一样，而是让关键动作可控、失败可定位、结果可追踪。

## 6. 面试官追问时的回答

### 问：这个项目和普通聊天机器人有什么区别？

> 普通聊天机器人更多是收消息、调模型、回消息。XiaoBa 更像 Agent Runtime，它要处理多入口会话隔离、角色配置、工具调用、Skill 扩展、异步任务、结果回传和异常恢复。尤其在企业 IM 场景里，发消息、发文件、长任务完成后回到原会话，这些都是 runtime 要保证的工程问题。

### 问：为什么这个项目不是产品经理用 Codex 就能做的 demo？

> 用 Codex 做一个能聊天的 demo 确实不难，但 XiaoBa 的复杂度在 demo 后面：多平台消息入口怎么统一，session 怎么隔离，长任务怎么不阻塞主会话，工具调用失败怎么处理，429/5xx 怎么重试，主备模型怎么 fallback，Skill 怎么按角色加载，结果怎么回注原会话，运行状态怎么可视化。这些需要 agent runtime 和工程系统设计能力，不只是生成几个页面或 prompt。

### 问：你在里面最能体现个人能力的点是什么？

> 我觉得是把模糊的 AI 助手需求拆成可工程化的 runtime 模块。比如 AgentSession 负责会话，ToolManager 负责工具边界，Role/Skill 负责能力扩展，subagent 负责异步任务，消息 adapter 负责平台接入，Dashboard 负责运行管理。这个拆分体现的是我对 agent 系统落地的理解：哪些可以交给模型，哪些必须由工程系统兜住。

### 问：大模型不稳定，你怎么保证结果稳定？

> 我不会说能让 LLM 绝对稳定。我的思路是让系统结果相对稳定：模型可以有不同表达，但关键行为走受控 runtime。比如工具调用、状态迁移、文件交付、错误处理和日志记录由 harness 管；对重要任务，后续可以通过 replay、verifier 和 scorecard 做评测回归。也就是说，稳定性不是来自单次 prompt，而是来自受控工具、状态机、日志和评测闭环。

### 问：这个项目和你其他项目有什么关联？

> GauzMem 让我做过长期记忆、知识图谱、向量检索和多跳推理；Vibe Writing 让我做过主对话 Agent、Planner、Executor、Review、Editor 的多 Agent 文档生成流程。XiaoBa 则是更底层的 Agent Runtime，它把会话、角色、工具、Skill、subagent 和消息入口统一起来。三个项目共同体现的是我对大模型应用工程化落地的理解。

## 7. 简历项目描述优化版

如果你后面要改简历，XiaoBa 项目可以写成下面这种更强的版本：

> **XiaoBa-CLI | 企业 IM Agent Runtime**  
> 技术栈：TypeScript、Node.js、Electron、Python  
> 面向企业 IM 智能助手场景，设计并实现统一 Agent Runtime，将会话管理、角色配置、工具调用、Skill 加载、消息接入与异步任务调度抽象为可复用底座，已在 3 家合作企业完成小规模部署，覆盖约 30-60 名内部用户。  
> - 实现 subagent 任务调度模块，基于父会话隔离子任务 session，维护 running / completed / failed / stopped 状态、执行进度日志与产出文件列表，支持异步执行、状态查询与完成后结果回注主会话。  
> - 构建 Role/Skill 扩展体系，基于 SKILL.md + frontmatter 实现 Skill 注册、递归发现、按角色动态加载与自动匹配，围绕合作企业需求沉淀 20+ 垂直行业 Skills。  
> - 打通飞书、微信消息入口，统一用户/群组维度会话隔离、过期清理与消息路由，降低多平台机器人接入成本。
> - 补充 Agent 调用链路异常处理，支持 429/5xx 可重试错误识别、指数退避重试、主备模型 fallback 与错误日志记录，提升企业 IM 场景下 Agent 服务稳定性。  
> - 设计 Agent2Agent 协作链路，基于 HTTP Bridge 支持群聊消息广播、异步结果回传与主 Agent 协同处理。  
> - 基于 Electron 封装跨平台桌面端与可视化 Dashboard，支持机器人服务管理、运行状态查看与本地化部署。

## 8. 最推荐的收束句

面试讲完后可以用这句话收尾：

> 所以我介绍 XiaoBa 时，不会把它定义成一个聊天机器人，而是定义成企业 IM 场景下的 Agent Runtime。这个项目最能体现的是我把 AI 产品需求工程化的能力：从消息入口、会话状态、角色和 Skill，到工具调用、异步任务、异常恢复和部署管理，我都做过实际落地。
