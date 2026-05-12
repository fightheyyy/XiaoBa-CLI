<div align="center">
  <img src="assets/banner.png" alt="XiaoBa Banner" width="100%">

  # XiaoBa

  **一个本地优先的 AI 角色 runtime：更懂你的电脑、聊天、工具和工作习惯。**

  **第一步从 IM-native 工作 agent 做起，长期承载围绕你生长的各种角色。**

  [![CI](https://github.com/fightheyyy/XiaoBa-CLI/actions/workflows/ci.yml/badge.svg)](https://github.com/fightheyyy/XiaoBa-CLI/actions/workflows/ci.yml)
  [![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
  [![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](package.json)
  [![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/fightheyyy/XiaoBa-CLI)

  [English](README.md)

  [快速开始](#快速开始) · [为什么是-xiaoba](#为什么是-xiaoba) · [角色体系](#角色体系) · [IM 入口](#im-入口) · [架构](#架构) · [文档](#文档)
</div>

---

## XiaoBa 是什么？

XiaoBa 不是另一个终端聊天壳子。

它是一个 **message-native agent runtime**：一个可以长期活在 IM 里的智能体。它能理解群聊 / 私聊上下文，接收文件和任务，调用工具或外部 coding agent 到后台干活，把产物发回来，并在真实环境里逐渐贴近你。

```text
IM 消息 / CLI 输入
  -> XiaoBa Runtime
  -> 角色身份
  -> Skills + tools + subagents
  -> 电脑 / 文件 / 项目 / shell / Codex / Claude Code / AutoDev
  -> 自然回复、文件交付、进度汇报或 case 流转
```

一句话：

> XiaoBa 把一次性的 AI 助手，变成长期活在你真实环境里的 AI 角色。

---

## 角色 Runtime 愿景

AI 角色产品已经证明：角色可以长期活在聊天里。XiaoBa 想做的是下一步：让角色活在你的真实环境里，包括你的电脑、文件、项目、工具、聊天、日志和长期记忆。

这个角色可以是同事、老师、学生、家人式陪伴、创作搭子、伴侣、审查员、督察员，也可以是只属于你的某种身份。角色可以变化，但 runtime 对你的环境和习惯的理解会持续生长。

第一步先从实用场景切入：**IM-native 工作 agent**。它能从聊天里接任务，调用工具，调度 Codex 或 Claude Code，并回到聊天里汇报结果。

---

## 快速开始

当前最推荐从源码启动。桌面安装包发布流程已经准备好，但在正式 release 之前，本地开发模式是最快路径。

```bash
git clone https://github.com/fightheyyy/XiaoBa-CLI.git
cd XiaoBa-CLI
npm install
cp .env.example .env
```

把模型配置写进 `.env`，也可以之后用 `npm run dev -- config` 打开交互式配置。

```bash
# OpenAI-compatible endpoint
GAUZ_LLM_PROVIDER=openai
GAUZ_LLM_API_BASE=https://api.openai.com/v1/chat/completions
GAUZ_LLM_API_KEY=your_api_key
GAUZ_LLM_MODEL=your_model

# 或 Anthropic
# GAUZ_LLM_PROVIDER=anthropic
# GAUZ_LLM_API_BASE=https://api.anthropic.com
# GAUZ_LLM_API_KEY=your_api_key
# GAUZ_LLM_MODEL=claude-sonnet-4-20250514
```

启动本地对话：

```bash
npm run dev -- chat -i
```

发送单条消息：

```bash
npm run dev -- chat -m "帮我总结这个项目的结构"
```

选择职业角色：

```bash
npm run dev -- chat -r engineer-cat -i
npm run dev -- chat -r reviewer-cat -i
```

启动桌面 Dashboard：

```bash
npm run electron:dev
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
npm run dev -- chat -i
```

---

## 为什么是 XiaoBa

大多数 AI coding 工具都活在终端或 IDE 里。但真实工作常常从别的地方开始：一条飞书消息、一个私聊、一个群里的 bug 报告、一个别人顺手丢过来的文件。

XiaoBa 做的是中间这层。

| 普通 coding agent | XiaoBa |
| --- | --- |
| 你打开终端才开始工作 | 可以活在 IM 入口里，响应真实消息 |
| 通常围绕一个本地仓库 | 围绕对话、文件、角色、任务和后续汇报组织工作 |
| 把结果打印在终端 | 可以发消息、发文件、回群汇报进度 |
| 通常只有一个 persona | 有职业角色，不同角色有不同职责和工具边界 |
| Memory 多是静态笔记 | 日志、工具、角色、交付口径和 runtime 行为一起被用户塑形 |

XiaoBa 不试图替代 Codex、Claude Code 或其他 coding agent。它把这些工具当作一个 IM-native 角色可以调度、判断、整合和汇报的外部能力。

---

## 核心能力

### IM-native Runtime

- CLI、飞书、微信、CatsCompany、Dashboard、桌宠入口共用同一套 runtime。
- 群聊、私聊、本地会话分别保留自己的 surface context。
- 用户可见输出通过消息 / 文件工具交付，而不是依赖普通模型文本。
- 长任务可以在后台继续，主会话仍然保持响应。

### 角色体系

- Roles 是职业身份，不只是 prompt 风格。
- 每个角色可以定义自己的 prompt、skills、tools 和行为边界。
- 当前内置工程、审查、督察、研究等工作流角色。
- 角色专属工具只会在对应角色激活时加载。
- 同一套 runtime 未来可以承载工作角色和个人角色，但每个角色的边界都应该清楚可控。

### Skills + Tools

- 内置文件、shell、grep、edit、send text、send file、log ingest、subagent 等工具。
- Skills 是本地 instruction packs，存放在 `skills/` 或 `roles/<role>/skills/`。
- 支持通过 `xiaoba skill install-github owner/repo` 从 GitHub 安装 skill。
- Skill parser 支持 Claude Code 风格 frontmatter。

### 后台任务

- `spawn_subagent` 可以启动后台 skill 工作。
- `check_subagent`、`stop_subagent`、`resume_subagent` 管理任务状态。
- `ask_parent` 允许子智能体暂停并向主会话请求确认。
- Reviewer 角色包含 Codex job tools，用于后台工程验证。

### User-shaped Harness

- 保留 session JSONL、runtime log、tool trace、token usage 和 artifacts，便于回放。
- memory finalization 可以从 session 中提取事实、偏好和工作习惯。
- context compression 保留近期高价值轮次，减少过期历史。
- AutoDev 集成可以把日志转成 inspect -> engineer -> review 的闭环。

---

## 角色体系

| Role | 身份 | 典型工作 |
| --- | --- | --- |
| <img src="dashboard/role-icons/engineer-cat.png" alt="EngineerCat" width="36"> `engineer-cat` | 活在 IM 里的工程师 | 读代码、拆任务、调用外部 coding agent、实现、验证、汇报 |
| <img src="dashboard/role-icons/reviewer-cat.png" alt="ReviewerCat" width="36"> `reviewer-cat` | 审查与验收负责人 | 追问证据、跑检查、审查产物、要求返工 |
| <img src="dashboard/role-icons/inspector-cat.png" alt="InspectorCat" width="36"> `inspector-cat` | Runtime 督察员 | 读日志、发现失败、创建或流转修复 case |
| <img src="dashboard/role-icons/researcher-cat.png" alt="ResearcherCat" width="36"> `researcher-cat` | 长周期研究助手 | 读论文、跟实验、维护证据和交付件 |

用角色启动：

```bash
npm run dev -- chat -r inspector-cat -i
```

角色定义在 [`roles/`](roles/README.md)。

---

## IM 入口

XiaoBa 提供本地 CLI 和多个消息入口 adapter。

| 入口 | 命令 | 说明 |
| --- | --- | --- |
| CLI chat | `npm run dev -- chat -i` | 最快的本地开发循环 |
| Feishu | `npm run dev -- feishu` | 需要 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` |
| Weixin | `npm run dev -- weixin` | 需要 `WEIXIN_TOKEN` |
| CatsCompany | `npm run dev -- catscompany` | 需要 `CATSCOMPANY_SERVER_URL` 和 `CATSCOMPANY_API_KEY` |
| Dashboard | `npm run dev -- dashboard` | 本地服务、状态和日志管理 |
| Desktop Pet | `npm run dev -- pet` | 本地桌宠入口 |

最小 IM runtime 设计见 [`docs/minimal-message-native-runtime.md`](docs/minimal-message-native-runtime.md)。

---

## 架构

![XiaoBa Architecture](docs/proposal-assets/xiaoba-cli-architecture-imagegen.png)

```text
src/index.ts
  -> commands/*
  -> AgentSession
  -> AIService provider chain
  -> Role-aware ToolManager
  -> Skills + tools + subagents
  -> Session store / logs / memory finalizer
```

关键模块：

- [`src/core/agent-session.ts`](src/core/agent-session.ts) 协调消息、命令、skills、memory 和 cleanup。
- [`src/tools/tool-manager.ts`](src/tools/tool-manager.ts) 注册文件、shell、消息、skill、subagent 工具。
- [`src/bootstrap/tool-manager.ts`](src/bootstrap/tool-manager.ts) 注入 role-aware tool sets。
- [`src/utils/ai-service.ts`](src/utils/ai-service.ts) 处理 provider 选择、重试和模型 failover。
- [`src/commands/feishu.ts`](src/commands/feishu.ts)、[`src/commands/weixin.ts`](src/commands/weixin.ts)、[`src/commands/catscompany.ts`](src/commands/catscompany.ts) 提供 IM adapter。

---

## 配置

基础模型配置：

```env
GAUZ_LLM_PROVIDER=openai
GAUZ_LLM_API_BASE=https://api.openai.com/v1/chat/completions
GAUZ_LLM_API_KEY=your_api_key
GAUZ_LLM_MODEL=your_model
```

可选备份模型：

```env
GAUZ_LLM_BACKUP_1_PROVIDER=openai
GAUZ_LLM_BACKUP_1_API_BASE=https://backup.example/v1/chat/completions
GAUZ_LLM_BACKUP_1_API_KEY=backup_key
GAUZ_LLM_BACKUP_1_MODEL=backup_model
```

IM adapter：

```env
FEISHU_APP_ID=your_app_id
FEISHU_APP_SECRET=your_app_secret
FEISHU_BOT_OPEN_ID=
FEISHU_BOT_ALIASES=小八,xiaoba

WEIXIN_TOKEN=your_token

CATSCOMPANY_SERVER_URL=
CATSCOMPANY_API_KEY=
```

AutoDev / inspection loop：

```env
AUTODEV_SERVER_URL=http://127.0.0.1:8090
AUTODEV_API_KEY=
LOG_INGEST_AUTO_ENABLED=true
```

完整示例见 [`.env.example`](.env.example)。

---

## Skills

查看 skills：

```bash
npm run dev -- skill list
```

从 GitHub 安装 skill：

```bash
npm run dev -- skill install-github owner/repo
```

创建本地 skill：

```text
skills/my-skill/
  SKILL.md
```

```markdown
---
name: my-skill
description: Use this when XiaoBa should follow my workflow.
invocable: user
---

# My Skill

Instructions go here.
```

详见 [`skills/README.md`](skills/README.md)。

---

## 开发

```bash
npm install
npm run build
npm test
```

桌面开发：

```bash
npm run electron:dev
```

构建桌面安装包：

```bash
npm run electron:build:mac
npm run electron:build:win
npm run electron:build:linux
```

发布流程见 [`docs/CD_RELEASE.md`](docs/CD_RELEASE.md)。

---

## 项目状态

| 模块 | 状态 |
| --- | --- |
| 本地 CLI chat | 可用 |
| Role runtime | 可用 |
| Skill loading 和 GitHub skill install | 可用 |
| 飞书 / 微信 / CatsCompany adapters | 可用，需要凭证 |
| Dashboard 和桌面 shell | 开发模式可用 |
| 桌面安装包发布 | GitHub Release workflow 已准备 |
| npm global package | 暂未发布 |

---

## 文档

- [IM-native Runtime Design](docs/minimal-message-native-runtime.md)
- [Data Flywheel E2E](docs/DATA_FLYWHEEL_E2E.md)
- [Case Replay Feedback Loop Spec](docs/CASE_REPLAY_FEEDBACK_LOOP_SPEC.md)
- [CD / Release](docs/CD_RELEASE.md)
- [Auto Update](docs/AUTO_UPDATE.md)
- [Roles Guide](roles/README.md)
- [EngineerCat Spec](roles/engineer-cat/SPEC.md)
- [ReviewerCat Spec](roles/reviewer-cat/SPEC.md)
- [Skill Guide](skills/README.md)

---

## 项目历史

XiaoBa-CLI 最初来自 [`buildsense-ai/XiaoBa-CLI`](https://github.com/buildsense-ai/XiaoBa-CLI)。当前仓库在 [`fightheyyy/XiaoBa-CLI`](https://github.com/fightheyyy/XiaoBa-CLI) 下独立继续推进，重点探索 IM-native agent、角色化工作、数据飞轮和桌面分发。

本 fork 的变更不会影响原 `buildsense-ai` 版本。

---

## License

Apache-2.0 © CatCompany

<div align="center">
  Built by CatCompany for agents that do not just answer, but show up where work happens.
</div>
