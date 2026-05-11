<div align="center">
  <img src="assets/banner.png" alt="XiaoBa Banner" width="100%">

  # 🐱 XiaoBa - 活在 IM 里的 Agent Runtime

  **IM-native Person Runtime｜职业角色｜越用越像你**

  [![CI](https://github.com/fightheyyy/XiaoBa-CLI/actions/workflows/ci.yml/badge.svg)](https://github.com/fightheyyy/XiaoBa-CLI/actions/workflows/ci.yml)
  [![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
  [![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/fightheyyy/XiaoBa-CLI)

  [快速开始](#-快速开始) • [核心理念](#-核心理念) • [核心能力](#-核心能力) • [开发](#-开发) • [文档](#-文档) • [Project History](#project-history)
</div>

---

> This fork continues XiaoBa-CLI independently after the original buildsense-ai version. New features and releases happen here.

---

## 💡 XiaoBa 是什么？

`XiaoBa` 不是一个“接了很多模型的聊天壳子”，也不是一个单纯的 coding agent。

它的基础定位是一个 **IM-native 的人**：

- 活在飞书、微信、CatsCompany、群聊和私聊里
- 有自己的身份、会话、记忆、工具和后台任务
- 能接话、接任务、发文件、查进度、回来汇报
- 能在不同场景切换成不同职业角色，比如工程师、审查员、研究员

如果一句话概括：

> `XiaoBa = 一个让 Agent 像人一样长期活在 IM 里的 runtime。Roles 是职业身份，Skills / Tools 是它的手脚，整个 harness 会在使用中逐渐被你塑形。`

---

## ✨ 核心理念

### 1. Runtime 是一个活在 IM 里的人

大多数真实工作不是发生在 IDE 里，而是发生在 IM 里。

你在群里沟通、在私聊里确认、把问题丢给 Claude Code / Codex、等结果、转述结论、推动别人、复盘问题。`XiaoBa` 要承载的是这一整套“人在组织里的行为”，而不是只做一次性的问答。

所以 XiaoBa 的基础 runtime 首先关心：

- 它在哪个 IM surface 里说话
- 它是在群聊还是私聊
- 它该不该回复，还是只旁听
- 它能不能把长任务放到后台
- 它完成后能不能回到 IM 里自然汇报

### 2. Roles 不是 prompt，而是职业身份

`roles` 不是简单的“风格预设”。它们是这个人在不同工作场景里的职业身份。

- `EngineerCat`：活在 IM 里的工程师，能读代码、拆任务、调 OMC / Codex / Claude Code、后台实现、验证并汇报
- `ReviewerCat`：活在 IM 里的审查员，能提出需求、追问证据、跑验收、要求返工
- `InspectorCat`：活在 IM 里的督察员，能看日志、发现问题、移交修复
- `ResearcherCat`：活在 IM 里的研究员，能读论文、整理证据、推进研究工作流

角色决定职业能力和职责边界；真正持续存在的是同一个 runtime。

### 3. Skills / Tools 是这个人的手脚

`send_text` 是说话，`send_file` 是发材料，`spawn_subagent` 是去后台干活，`ask_parent` 是回来问你一句，`execute_shell` / `read_file` / `edit_file` 是工程动作。

XiaoBa 不把工具堆给用户看，而是把它们组织成一个人在 IM 里自然完成工作的动作。

### 4. 越用越像你，不只是 Memory

XiaoBa 的长期产品力不是模型参数，也不是单独一个 memory 模块。

真正会变得像你的，是整个 harness：

- 你的说话方式
- 你的工程品味
- 你的常用项目和工具链
- 你的同事关系和群聊上下文
- 你的承诺、待办、禁忌和失败教训
- 你希望它自动做什么，什么必须先问你
- 你在不同职业角色下如何判断、派活、验证和交付

`memory` 负责沉淀事实和经验；`roles` 负责把这些经验组织成不同职业身份；`skills / tools` 负责把偏好落实成动作；`runtime harness` 负责在 IM 里决定何时说话、何时沉默、何时后台执行、何时请求确认。

所以“越用越像你”不是记住更多资料，而是整个运行方式越来越接近你的工作习惯。

---

## 🚀 核心能力

### 🧍 IM-native Person Runtime

- 一套 runtime 承载 CLI、飞书、微信、CatsCompany、桌宠等入口
- 区分群聊 / 私聊 / 本地桌面等 surface，保留对应会话上下文
- 支持 IM 中的自然回复、文件收发、附件理解、任务进度汇报
- 提供本地 `Dashboard` 管理服务启动、日志查看和运行状态

### 🎭 职业角色体系

- 用 `roles` 描述职业身份，而不是复制多套 runtime
- 不同角色拥有不同 prompt、skills、tools 和工作边界
- 当前内置 `EngineerCat / ReviewerCat / InspectorCat / ResearcherCat`
- 用户可以继续扩展自己的职业角色

### 🧬 User-shaped Harness

- 沉淀 session `JSONL`、runtime `.log`、工具调用记录和 token 轨迹
- 从真实对话中提取任务、事实、承诺、产物和风险
- 通过 `roles` 把用户习惯组织成不同职业身份，而不是只存成静态记忆
- 让 prompt、角色、工具调度、后台任务、权限边界和交付口径一起被用户塑形
- 支持 working-memory 风格的上下文压缩，保留近期关键轮次

### 🏃 后台任务与协作

- 主会话保持在 IM 里可响应
- 长任务可以派给 subagent 后台执行
- 支持进度查询、停止、继续、等待用户确认和完成后回报
- 支持围绕同一个 case 进行 Inspector -> Engineer -> Reviewer 流转

### 🛠️ 工具与 Coding Agent 调度

- 具备基础 coding agent 能力：读文件、改文件、跑命令、查日志、写文档
- Engineer 角色可通过 OMC 调用 Codex / Claude Code / OMC team
- 不重复造 Claude Code / Codex 的轮子，而是把它们当作 IM 工程师的外部工具
- 外部 agent 输出需要被 XiaoBa 二次判断、整合和验证

### 🛡️ 稳定性与工程化

- 支持多模型 `Failover`
- 支持 `429` 限流识别与自动重试
- 支持工具调用可靠性治理与错误分类
- 支持完整会话日志、Token 消耗统计与行为回放
- 基于 `Electron` 提供跨平台桌面分发

---

## 🖥️ 使用场景

`XiaoBa` 适合这些场景：

- 在飞书 / 微信 / 群聊里长期存在的个人工作 agent
- 活在 IM 里的工程师、审查员、研究员或其他职业角色
- 把日常沟通、任务推进、文件产出和工具调用串起来
- 把 Claude Code / Codex 等 coding agent 接入真实 IM 工作流
- 通过真实使用日志持续沉淀个人化记忆和工作习惯

---

## 🚀 快速开始

### 从源码启动

```bash
git clone https://github.com/fightheyyy/XiaoBa-CLI.git
cd XiaoBa-CLI
npm install
cp .env.example .env
npm run dev -- chat -i
```

Windows PowerShell 可用下面的命令复制配置文件：

```powershell
Copy-Item .env.example .env
```

如果你想启动桌面 Dashboard：

```bash
npm run electron:dev
```

### 选择职业角色

```bash
npm run dev -- chat -r engineer-cat -i
npm run dev -- chat -r reviewer-cat -i
```

### 桌面安装包

桌面安装包会通过 [GitHub Releases](https://github.com/fightheyyy/XiaoBa-CLI/releases) 发布。当前仓库进入首个正式 release 前，推荐先使用源码启动。

### 基础配置
复制 `.env.example` 为 `.env`，填入配置：
```bash
# LLM 配置
GAUZ_LLM_PROVIDER=anthropic
GAUZ_LLM_API_KEY=your_api_key

# 飞书机器人（可选）
FEISHU_APP_ID=your_app_id
FEISHU_APP_SECRET=your_app_secret

# 微信机器人（可选）
WEIXIN_TOKEN=your_token
```

---

## 🛠️ 开发

```bash
# 安装依赖
npm install

# 开发模式
npm run electron:dev

# 构建
npm run electron:build:win
npm run electron:build:mac
npm run electron:build:linux
```

---

## 📚 文档

- [Skill 开发指南](https://github.com/buildsense-ai/XiaoBa-Skill-Hub)
- [IM-native Runtime 设计](docs/minimal-message-native-runtime.md)
- [数据飞轮 E2E](docs/DATA_FLYWHEEL_E2E.md)
- [CD / Release](docs/CD_RELEASE.md)
- [Auto Update](docs/AUTO_UPDATE.md)
- [Roles 目录说明](roles/README.md)
- [EngineerCat Spec](roles/engineer-cat/SPEC.md)
- [ReviewerCat Spec](roles/reviewer-cat/SPEC.md)

---

## 🏪 Skill Hub

当前可参考原项目的 [XiaoBa-Skill-Hub](https://github.com/buildsense-ai/XiaoBa-Skill-Hub) 获取更多社区 Skills。本 fork 会继续保持兼容，并可在后续独立扩展新的 skills 与角色能力。

---

## Project History

XiaoBa-CLI 最初来自 [buildsense-ai/XiaoBa-CLI](https://github.com/buildsense-ai/XiaoBa-CLI)。当前仓库由原项目参与者继续独立维护，用于探索新的功能方向、实验性能力和后续 release。

本仓库的新功能、问题修复和发布节奏不会影响 `buildsense-ai` 组织下原版本的维护；如果你想跟进当前活跃版本，请以 [fightheyyy/XiaoBa-CLI](https://github.com/fightheyyy/XiaoBa-CLI) 为准。

---

## 📄 License

Apache-2.0 © CatCompany

---

<div align="center">
  Made with ❤️ by CatCompany
</div>
