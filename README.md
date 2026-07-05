<div align="center">
  <img src="assets/hero.gif" alt="Agents can grow. XiaoBa makes growth reviewable." width="100%">

  # XiaoBa-CLI

  **可治理自进化 Agent Runtime。**

  让 agent 能沉淀 skill、复用经验、长期成长；也让每一次成长都能被 trace 留证、replay 复跑、Arena scorecard 验收。

  > Agent 可以成长，但不能乱长。

  [![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
  [![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](package.json)
  [![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)](https://github.com/fightheyyy/XiaoBa-CLI)

  [English](README.en.md) · [快速开始](#快速开始) · [Arena](#arena) · [证据](#证据) · [文档](#文档)
</div>

---

## XiaoBa 在干嘛

很多 agent 都会“生成 skill”或“总结经验”。真正的问题是：这些成长到底能不能信，升级后会不会回归，出问题时人类能不能查证、复跑和管住它。

XiaoBa-CLI 把 self-evolution 变成一个可治理闭环：

```text
skill / role candidate
  -> clean runtime
  -> real multi-turn use
  -> native trace / artifacts
  -> issue extraction
  -> replay / verifier / scorecard
  -> pass / unstable / reopened / blocked / unsafe
```

这不是又一个 agent 聊天壳。XiaoBa 的目标是：

```text
Agents can grow.
XiaoBa makes growth reviewable.
```

## 为什么不一样

- **Runtime**：给 agent 一个能工作的身体，roles、skills、tools、subagents、memory、files、delivery 和 session state 都在同一个可恢复 runtime 里协作。
- **Evidence**：不只记录“模型说了什么”，还记录真实工具调用、文件产物、用户可见交付、session trace 和 artifact evidence。
- **Replay**：历史真实会话可以重新驱动当前 runtime，抓出回归、假成功、缺失产物和不稳定行为。
- **Arena**：新 skill、新 role、self-evolution 产物默认都是候选能力；Arena 会把它们放进干净 runtime，由 UserCat 真实多轮使用，再交给 InspectorCat 抽 case，ReviewerCat replay 和评分。

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

## Arena

评测一个已安装 skill：

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

## 默认能力

默认包只带最小可信核心：

- Roles：`user-cat`、`inspector-cat`、`engineer-cat`、`reviewer-cat`
- Skills：`remember`、`agent-browser`、`skill-publish`、`role-publish`、`self-evolution`

更多 role / skill 通过显式安装进入，且应先经过 Arena 或人工验收。

## 证据

Arena 当前已经在 7 条 SkillsBench-derived 外部 gold case 上跑通 live proof：2 条 baseline + 5 条 broad holdout，false pass = 0。完整 proof corpus 不随 XiaoBa-CLI 主仓发布，后续归 Barena 或本地 ignored 数据目录管理。

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
