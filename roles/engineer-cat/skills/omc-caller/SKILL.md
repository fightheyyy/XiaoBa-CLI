---
name: omc-caller
description: 复用 oh-my-claude-sisyphus/OMC，通过 OMC 把 Claude Code / Codex CLI 作为外部顾问或 tmux 工作者来调度。
aliases:
  - omc
  - claude-code-caller
  - codex-caller
  - call-codex
  - call-claude
user_invocable: true
invocable: both
argument-hint: "<要交给 Claude Code / Codex / OMC 的任务>"
max-turns: 20
---

# OMC Caller

这个 skill 用来让 EngineerCat 复用 OMC，而不是在 XiaoBa 里重新实现 Claude Code / Codex 编排。

泛化入口使用配置化命令，不写任何个人机器绝对路径。

## 适用场景

- 用户明确说“让 Codex 看一下”“找 Claude Code 干活”“用 OMC/team/ask”
- 任务需要第二视角：架构审查、安全审查、实现方案对比、测试策略
- 任务可以拆给真实 CLI 工作者并行完成
- 用户想把 EngineerCat 定位成日常上班的 Codex / Claude Code 调用人

## OMC 入口

入口解析顺序：

1. 如果用户或运行环境显式设置了 `OMC_BIN`，使用 `OMC_BIN`
2. 否则使用 PATH 中的 `omc`
3. 如果都不可用，停止调用并提示安装，不猜测源码 checkout 路径

推荐安装方式：

```bash
npm i -g oh-my-claude-sisyphus@latest
```

不要把 OMC 的 ask/team/provider/artifact 编排复制进 XiaoBa。EngineerCat 只负责选择配置化 OMC 入口、组织 prompt、调用、读取结果和综合判断。

禁止把个人机器路径、临时 checkout 路径或 `/Users/...` 这类路径写成 fallback。用户明确给出某个 `OMC_BIN` 时才可使用。

## 调用策略

### 1. 快速外部意见

用于审查、方案评估、风险识别、测试建议。

```bash
omc ask codex "<清晰、带工作目录和目标的 prompt>"
omc ask claude "<清晰、带工作目录和目标的 prompt>"
```

如果 `OMC_BIN` 和 PATH 中的 `omc` 都不可用，停止调用并提示安装 npm 包或设置 `OMC_BIN`。

### 2. 真实 CLI 工作者

用于并行实现、批量审查、跨模块任务。需要 `tmux`。

```bash
omc team 2:codex "<task>"
omc team 1:claude "<task>"
omc team 1:codex,1:claude "<task>"
```

如果 `OMC_BIN` 和 PATH 中的 `omc` 都不可用，停止调用并提示安装 npm 包或设置 `OMC_BIN`。

启动前必须检查：

```bash
command -v tmux
command -v codex
command -v claude
```

没有 `tmux` 时，不要声称 team 已启动。改用 `ask` 或直接说明缺少 tmux。

### 3. Codex 优先场景

- 代码审查
- 安全与架构风险
- TypeScript / CLI / runtime 设计
- 测试策略和边界条件

### 4. Claude Code 优先场景

- 长链路实现
- 需要 Claude Code 插件、技能、agent 生态
- 需要 OMC 原生 Team 或 Autopilot 工作流
- 需要把需求拆成 staged pipeline

## 执行规程

1. 先把用户任务改写成外部 CLI 能独立理解的 prompt，包含 repo 路径、目标、约束和期望输出。
2. 根据任务复杂度选择 `ask` 或 `team`。
3. 调用后读取 OMC 产物或命令输出。
4. 自己综合判断，不盲从外部结果。
5. 如果要改 XiaoBa 代码，仍按 EngineerCat 的最小补丁和验证规则执行。
6. 最终回复用户时，说清楚调用了谁、采用了什么结论、落地改了什么。

## Coding Agent Prompt 标准

不要把用户原话直接转发给 Codex / Claude Code。调用 OMC 前，先把任务整理成这种结构：

```text
Repo: <绝对路径>
Goal: <这次要解决的问题>
Context: <已知背景、相关文件、已有判断>
Scope: <允许读/改的范围>
Constraints: <不要做什么、风格、风险边界>
Expected output: <review / plan / patch / implementation / test strategy>
Validation: <如何判断输出有用>
Format: <希望对方怎样组织答案>
```

读取结果后要做二次评估：

- 是否回答了 Goal
- 是否遵守 Scope / Constraints
- 是否基于当前仓库事实
- 是否给出可验证动作
- 是否需要追问同一个 provider
- 是否需要换另一个 provider 交叉验证

## 失败处理

- `omc: command not found`：建议 `npm i -g oh-my-claude-sisyphus@latest`，或让用户显式设置 `OMC_BIN`
- `tmux: command not found`：不启动 team；改用 `ask` 或提示安装 tmux
- `codex: command not found`：OMC 的 Codex provider 不可用；改用 OMC Claude provider 或说明缺失
- `claude: command not found`：OMC 的 Claude provider 不可用；改用 OMC Codex provider 或说明缺失
- OMC 产物缺失：读取命令输出，必要时重跑一次更小的 prompt
