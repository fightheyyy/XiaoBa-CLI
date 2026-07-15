<div align="center">
  <img src="assets/harness-social-preview.jpg" alt="XiaoBa Harness：从消息入口调度角色 Agent，并交付文件、消息和可回放证据" width="100%">

  # XiaoBa-CLI

  **一套持续进化的 IM-native AI 同事 Runtime。**

  把任务发给 XiaoBa。它负责沟通和派工，让角色 Agent 在后台执行，再把文件、消息和可回放证据交付回来。

  <em>Message your work. XiaoBa works like a teammate.</em>

  [![Release](https://img.shields.io/github/v/release/fightheyyy/XiaoBa-CLI?include_prereleases&label=release)](https://github.com/fightheyyy/XiaoBa-CLI/releases/tag/v0.1.1)
  [![Desktop](https://img.shields.io/badge/desktop-macOS%20Apple%20Silicon-yellow.svg)](https://github.com/fightheyyy/XiaoBa-CLI/releases/tag/v0.1.1)
  [![Node](https://img.shields.io/badge/CLI-Node.js%20%3E%3D18-green.svg)](package.json)
  [![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

  [下载 macOS 预览版](https://github.com/fightheyyy/XiaoBa-CLI/releases/tag/v0.1.1) · [快速开始](#快速开始) · [工作原理](#工作原理) · [自进化](#自进化工作流) · [证据与评测](#证据与评测) · [English](README.en.md)

  <sub>当前桌面包为 Apple Silicon 技术预览版，采用 ad-hoc 签名，尚未完成 Apple notarization。</sub>
</div>

---

## 把工作发给 XiaoBa

XiaoBa-CLI 不是另一个只会连续输出文字的 chatbot。它是一套围绕真实工作流设计的 **AI coworker harness runtime**：Base Main Agent 是唯一面向用户的沟通和调度入口，专业角色接管长任务，同一套 runtime 负责工具执行、状态恢复、交付和证据。

| 你要完成的事 | XiaoBa 如何接管 | 最终交付 |
| --- | --- | --- |
| 修改代码、修复问题、验证构建 | EngineerCat 进入仓库和工程环境执行 | 代码改动、测试结果和 artifact evidence |
| 浏览网页、收集资料、核验页面 | BrowserCat 通过受限 driver 执行浏览器任务 | 结构化结果、来源和页面证据 |
| 操作桌面应用 | GuiCat 通过 macOS GUI driver 执行 | 操作结果和 GUI evidence |
| 处理飞书日历、消息、任务和文档 | SecretaryCat 调用官方 `lark-cli` 工作流 | 飞书侧结果、文件和 delivery evidence |
| 验收一个新 skill 或 role | 独立 Arena 运行 UserCat 场景、Inspector 取证和多轮 replay/compare | Arena scorecard 和明确结论 |

运行状态、trace 和 artifact evidence 默认保存在本地；模型 provider 可以按配置连接 OpenAI-compatible、Anthropic、Ollama 或其他兼容端点。

## 工作原理

```text
CLI / Feishu / WeChat / Pet / Dashboard
                    |
                    v
       Base Main Agent：沟通、判断、派工
                    |
                    v
      Role Subagent：后台接管专业任务
                    |
                    v
        Tools / Drivers / Files / Messages
                    |
                    v
      Deliverables + Trace + Replay + Scorecard
```

- **一个控制平面**：Base 是唯一面向用户的主 Agent；四个功能型 Role 和四个内部持续改进 Role 复用同一套 XiaoBa Agent loop。
- **两类角色**：功能型 Role 接管用户任务；内部持续改进 Role 按需参与 trace 生产、诊断、能力生成和独立回放，并不构成一套常驻的第二系统。
- **确定性能力边界**：浏览器、GUI 和飞书 driver 只提供能力，不启动第二套 Chat、Agent 或 MCP loop。
- **交付优先**：文件、消息和工具结果进入结构化 evidence，不把“模型说完成了”当作完成。
- **本地可复盘**：trace、artifact、delivery、replay 和 scorecard 形成可追溯证据链。

## 运行界面

<p align="center">
  <img src="assets/dashboard.png" alt="XiaoBa Runtime Dashboard：运行服务、角色、技能、配置、商店和 Chat" width="100%">
</p>

<p align="center"><sub>Electron Dashboard 把运行服务、角色、技能、配置、商店和 Chat 收在同一个本地入口。</sub></p>

## 八个默认角色：4 个功能型 + 4 个内部持续改进

Base Main Agent 负责面向用户、判断和派遣。八个 Role 是同一套 Runtime 上的专业配置，不是八套独立 Agent 框架；Base 默认不常驻 Skill。

### 4 个功能型 Role

它们直接接管用户任务，并持有对应领域的工具、权限和交付边界。

| Role | 责任 |
| --- | --- |
| EngineerCat | 接管代码、仓库和构建；也可承接 Inspector/Reviewer 明确移交的工程修复 |
| BrowserCat | 接管浏览器任务，执行受限且可验证的页面操作 |
| GuiCat | 接管 macOS 桌面 GUI 任务 |
| SecretaryCat | 接管飞书工作流；`FeishuCat` 是别名，领域能力由官方 `lark-cli` 提供 |

### 4 个内部持续改进 Role

它们服务于评测与自进化 workflow，按场景启动，不作为四个常驻 Agent 同时运行。

| Role | 责任 |
| --- | --- |
| UserCat | 作为内部 evaluation actor，用低信息、真实用户式输入给候选能力施压并产出候选 trace；不是 nightly trace 的固定上游 |
| InspectorCat | 从真实 session trace、工具和 artifact 中发现问题、保留证据并输出类型化 route |
| EvolutionCat | 把 Inspector 发现的可泛化模式沉淀为候选 Skill/Role，并负责显式发布工作流；`remember` 是其确定性 runtime tool |
| ReviewerCat | 在干净 session 正式回放单个 Replay Case，并给出 `closed / next_run / blocked`；Arena 独立汇总能力 scorecard |

这是职责分类，不是两套 Runtime。内部四个 Role 也不构成一条每次全部执行的线性链：nightly 从 InspectorCat 开始，EvolutionCat、ReviewerCat 按 route 参与，UserCat 主要用于按需测试和 Arena 场景；`repair` 可以调用功能型的 EngineerCat。

## 自进化工作流

XiaoBa 的自进化不是 Base 在对话里临时“反思”，而是一条由 runtime 每夜启动、跨角色执行的确定性 DAG。InspectorCat 始终是第一个内部角色：它扫描 session trace，产出带证据的 finding 和类型化 route。内部持续改进 Role 按 route 参与，并非每晚全部启动。

<p align="center">
  <img src="assets/self-evolution-dag.png" alt="XiaoBa Self-Evolution DAG：InspectorCat 将 session trace 路由到 evolution、repair、replay 或 no-op 终态" width="100%">
</p>

`evolution` 由 EvolutionCat 生成候选 Skill/Role，再交给独立 Arena 做多 case 评测；`repair` 由 EngineerCat 修复后交给 ReviewerCat 正式回放；`replay` 直接进入 ReviewerCat；`no_op` 在没有足够信号时显式终止。候选能力不会自动污染默认包，发布仍需显式执行。

## 快速开始

### macOS Desktop Preview

[下载 XiaoBa v0.1.1 macOS Preview](https://github.com/fightheyyy/XiaoBa-CLI/releases/tag/v0.1.1)

- 当前 DMG 面向 Apple Silicon（arm64）。
- 这是公开技术预览版，不是已签名、notarized 的稳定发行版。
- 完整校验值、源码 commit 和已知限制见 Release Notes。

### CLI / 源码运行

需要 Node.js 18 或更高版本：

```bash
git clone https://github.com/fightheyyy/XiaoBa-CLI.git
cd XiaoBa-CLI
npm install
cp .env.example .env
```

在 `.env` 中配置模型：

```env
XIAOBA_LLM_PROVIDER=openai
XIAOBA_LLM_API_BASE=https://api.openai.com/v1
XIAOBA_LLM_API_KEY=your_api_key
XIAOBA_LLM_MODEL=your_model
```

启动交互式 CLI：

```bash
npm run dev -- chat -i
```

指定角色：

```bash
npm run dev -- chat -r engineer-cat -i
```

启动 Electron Dashboard：

```bash
npm run electron:dev
```

BrowserCat、GuiCat 和 SecretaryCat 等角色的外部 CLI / 平台依赖见 [`requirement.txt`](requirement.txt)。只在使用对应角色时安装和授权这些依赖。

## 证据与评测

XiaoBa 把“完成”拆成可以检查的事实，而不是依赖一段看起来正确的回答。

| 证据层 | 当前作用 |
| --- | --- |
| Trace | 保存一次用户请求中的模型、工具、失败、交付和 runtime event |
| Artifact / Delivery Evidence | 记录文件、消息、外部回执和实际交付结果 |
| Trace Replay | 用历史用户意图重新驱动当前 runtime，观察行为是否变化 |
| Live Agent Eval | 对 curated case fresh-run 当前 runtime，并运行 hard verifiers |
| Arena | 在 clean runtime 中验收候选 skill / role，输出可审计 scorecard |

当前 BaseRuntime 维护 11 条 fresh-run live cases。Arena 还用 7 条 SkillsBench-derived controlled cases 校准 UserCat、InspectorCat 和 ReviewerCat；这只支持当前受控样本内的窄结论，不代表所有 provider、skill 或未来版本都已稳定。

```bash
npm test
npm run replay:trace
npm run eval:base-runtime
npm run check:benchmarks
```

证据边界见 [Evaluation SPEC](docs/evaluation/SPEC.md) 和 [Arena Calibration Evidence](docs/arena/SPEC.md#calibration-evidence)。最近验证状态只维护在 [Project PLAN](docs/PLAN.md)，避免 README 里的数字过期。

## Arena：能力进入默认包之前先验收

Arena 不会因为一个 skill 写得像说明书就信任它。候选能力会进入隔离的 clean runtime，经过 UserCat 场景、Inspector 证据提取和 Arena 自己的多轮 replay/compare，再输出 `pass`、`unstable`、`reopened`、`blocked` 或 `unsafe`。ReviewerCat 只负责 DAG 中单个 Replay Case 的正式回放。

```bash
xiaoba arena skill <skill-name>
```

Arena 固定支持 `base + skill`、`role + skill` 和 `role` 三种 review mode；promotion 必须由人明确执行，Arena 不会自动污染生产 `skills/` 或角色注册表。

## 当前边界

- macOS Electron DMG 仍是未 notarize 的 Apple Silicon preview。
- BrowserCat、GuiCat 和 SecretaryCat 依赖各自固定或官方的外部 driver/CLI，并需要对应安装、权限或登录状态。
- Dashboard、Pet 和 Bridge 的控制面仍以本地使用为主，尚未完成面向不可信网络的完整认证与 Owner 授权。
- Trace Replay 可能执行当前真实 side effect；在 side-effect isolation 完成前，不应对任意历史 trace 无审查批量复跑。

## 常用命令

| 目标 | 源码开发 | CLI bin |
| --- | --- | --- |
| 交互聊天 | `npm run dev -- chat -i` | `xiaoba chat -i` |
| 单条消息 | `npm run dev -- chat -m "帮我总结这个项目"` | `xiaoba chat -m "帮我总结这个项目"` |
| 指定角色 | `npm run dev -- chat -r engineer-cat -i` | `xiaoba chat -r engineer-cat -i` |
| 验收 skill | `npm run dev -- arena skill <skill-name>` | `xiaoba arena skill <skill-name>` |
| 运行夜间演化 | `npm run dev -- evolution sleep` | `xiaoba evolution sleep` |
| 安装 macOS 03:17 定时任务 | `npm run dev -- evolution schedule install` | `xiaoba evolution schedule install` |
| Dashboard | `npm run electron:dev` | - |
| 构建 | `npm run build` | - |
| 测试 | `npm test` | - |

## 文档与社区

- [Project Architecture](docs/SPEC.md)
- [Project Status / Plan](docs/PLAN.md)
- [Roles Guide](roles/README.md)
- [Skills Guide](skills/README.md)
- [Releases](https://github.com/fightheyyy/XiaoBa-CLI/releases)
- [Discussions](https://github.com/fightheyyy/XiaoBa-CLI/discussions)
- [Issues](https://github.com/fightheyyy/XiaoBa-CLI/issues)

## License

[Apache-2.0](LICENSE)
