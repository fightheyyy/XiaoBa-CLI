<div align="center">
  <img src="assets/hero.gif" alt="Message your work. XiaoBa works like a teammate." width="100%">

  # XiaoBa-CLI

  **一个 IM-native 的 AI 同事 Runtime。**

  拟人交付、异步 subagents、可观测 replay eval；让 Agent 像同事一样接活，也让它做过的事能被复盘。

  `CLI / Dashboard / 桌宠 / 飞书 / 微信`<br>
  `Human-like Reply / Async Subagents / Roles & Skills`<br>
  `Trace / Replay / Scorecard / Agentic Eval`

  > 像同事一样接活，不像 chatbot 一样刷屏。

  [![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
  [![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](package.json)
  [![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)](https://github.com/fightheyyy/XiaoBa-CLI)

  [English](README.en.md) · [快速开始](#快速开始) · [Arena](#arena) · [证据](#证据) · [文档](#文档)
</div>

---

## XiaoBa 在干嘛

XiaoBa-CLI 不是再做一个更会聊天的 agent，而是做一个 **IM-native AI coworker runtime**：用户从 IM、CLI、Dashboard 或桌宠丢任务进来，XiaoBa 接活、派工、后台执行、回收证据，再把结果交付回来。

它围绕四件事设计：

1. **拟人**：少废话，不把工具日志甩给用户；该确认时确认，该交付时交付，后台跑时就安静跑。
2. **Subagent / 多 role**：主 agent 负责对话和调度，长任务交给 role / subagent 后台执行，IM 主对话不被阻塞。
3. **可观测 / 可回放 / 可评测 / 可回归**：每次工作都留下 trace、tool result、artifact、replay 和 scorecard，出问题能复盘，升级后能回归。
4. **Agentic Eval**：XiaoBa 内置早期 Arena 做本地能力验收；更完整的 CI for agents 会独立到 Barena：`Agents can grow. Barena makes growth reviewable.`

核心工作流：

```text
IM / CLI / Dashboard / Pet -> XiaoBa Runtime
  -> main agent -> role / subagent
  -> tools / files / messages
  -> trace / replay / scorecard
```

XiaoBa 负责让 AI 同事能长期干活。Arena / Barena 负责让能力变化可复盘、可回放、可评分。

## 为什么不一样

- **IM-native**：不是一次性 CLI prompt，而是面向消息入口、长对话和长任务的 runtime。
- **像同事**：用户看到的是短反馈和交付结果，不是冗长链路说明和 raw tool log。
- **异步派工**：subagent / role 在后台接管长任务，主对话继续可交互。
- **Replay eval**：trace、artifact、replay、scorecard 形成可复盘的工作证据链。

## 快速开始

```bash
git clone https://github.com/fightheyyy/XiaoBa-CLI.git
cd XiaoBa-CLI
npm install
cp .env.example .env
```

在 `.env` 写入模型配置：

```env
XIAOBA_LLM_PROVIDER=openai
XIAOBA_LLM_API_BASE=https://api.openai.com/v1
XIAOBA_LLM_API_KEY=your_api_key
XIAOBA_LLM_MODEL=your_model
```

源码开发模式：

```bash
npm run dev -- chat -i
npm run dev -- chat -r engineer-cat -i
```

安装或 `npm link` 后：

```bash
xiaoba chat -i
xiaoba chat -r engineer-cat -i
```

启动桌面 Dashboard：

```bash
npm run electron:dev
```

## Arena / Barena

XiaoBa 内置早期 Arena 子模块，用来做本地 skill / role 能力验收。评测一个已安装 skill：

```bash
xiaoba arena skill <skill-name>
```

源码开发模式等价命令：

```bash
npm run dev -- arena skill <skill-name>
```

Arena 固定三种使用场景：

| 场景 | 目标 |
| --- | --- |
| `base + skill` | 测 skill 在最干净 base runtime 里是否高可用 |
| `role + skill` | 测 skill 引入指定 role 后是否可靠 |
| `role` | 测一个 role 本身是否可靠 |

后续更完整的 Agentic Eval / CI for agents 会独立成 Barena：

```text
Agents can grow.
Barena makes growth reviewable.
```

## 默认能力

默认包只带最小可信核心：

- Roles：`user-cat`、`inspector-cat`、`engineer-cat`、`reviewer-cat`
- Skills：`remember`、`agent-browser`、`skill-publish`、`role-publish`、`self-evolution`

更多 role / skill 通过显式安装进入，且应先经过 Arena 或人工验收。

## 证据

Arena 当前已经在 7 条 SkillsBench-derived 外部 gold case 上跑通 live proof：2 条 baseline + 5 条 broad holdout，false pass = 0。完整 proof corpus 不随 XiaoBa-CLI 主仓发布，后续归本地 ignored 数据目录或独立评测 corpus 管理。

这证明的是当前 `UserCat -> InspectorCat -> ReviewerCat` loop 能保留真实证据、抽取 issue/case、执行多轮 replay，并在外部 verifier 失败或 replay 不稳定时避免误判为 pass。它不声称所有 skill 已经稳定，也不声称跨 provider / 跨时间窗口完全泛化。

完整边界见：

- [Cat Effectiveness Technical Report](docs/arena/CAT_EFFECTIVENESS_REPORT.md)
- [Arena Effectiveness Experiment](docs/arena/ARENA_EFFECTIVENESS_EXPERIMENT.md)

## 常用命令

| 目标 | 源码开发 | CLI bin |
| --- | --- | --- |
| 交互聊天 | `npm run dev -- chat -i` | `xiaoba chat -i` |
| 单条消息 | `npm run dev -- chat -m "帮我总结这个项目"` | `xiaoba chat -m "帮我总结这个项目"` |
| 指定角色 | `npm run dev -- chat -r engineer-cat -i` | `xiaoba chat -r engineer-cat -i` |
| 评测 skill | `npm run dev -- arena skill <skill-name>` | `xiaoba arena skill <skill-name>` |
| Dashboard | `npm run electron:dev` | - |
| 构建 | `npm run build` | - |
| 测试 | `npm test` | - |

## 文档

README 只讲一眼能懂的产品入口；详细架构、模块边界和长期计划在文档里。

- [Docs Index](docs/README.md)
- [Project SPEC](docs/SPEC.md)
- [Project PLAN](docs/PLAN.md)
- [Agent Runtime SPEC](docs/agent-runtime/SPEC.md)
- [Trace Replay SPEC](docs/trace-replay/SPEC.md)
- [Arena SPEC](docs/arena/SPEC.md)
- [Arena PLAN](docs/arena/PLAN.md)
- [Skills Guide](skills/README.md)
- [Roles Guide](roles/README.md)

## License

Apache-2.0
