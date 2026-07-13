<div align="center">
  <img src="assets/harness-social-preview.jpg" alt="XiaoBa Harness dispatches role agents from message surfaces and returns files, messages, and replayable evidence" width="100%">

  # XiaoBa-CLI

  **An IM-native AI coworker runtime built to keep evolving.**

  Send work to XiaoBa. It owns the conversation and dispatch, lets role agents execute in the background, then returns deliverables with replayable evidence.

  <em>Message your work. XiaoBa works like a teammate.</em>

  [![Release](https://img.shields.io/github/v/release/fightheyyy/XiaoBa-CLI?include_prereleases&label=release)](https://github.com/fightheyyy/XiaoBa-CLI/releases/tag/v0.1.1)
  [![Desktop](https://img.shields.io/badge/desktop-macOS%20Apple%20Silicon-yellow.svg)](https://github.com/fightheyyy/XiaoBa-CLI/releases/tag/v0.1.1)
  [![Node](https://img.shields.io/badge/CLI-Node.js%20%3E%3D18-green.svg)](package.json)
  [![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

  [Download macOS Preview](https://github.com/fightheyyy/XiaoBa-CLI/releases/tag/v0.1.1) · [Quick Start](#quick-start) · [How It Works](#how-it-works) · [Evidence & Evaluation](#evidence--evaluation) · [简体中文](README.md)

  <sub>The current desktop package is an Apple Silicon technical preview. It is ad-hoc signed and not yet Apple-notarized.</sub>
</div>

---

## Send Work to XiaoBa

XiaoBa-CLI is not another chatbot that only produces more text. It is an **AI coworker harness runtime** designed around real workflows: the Base Main Agent is the only user-facing conversation and dispatch layer, specialist roles take over long-running work, and one shared runtime owns tool execution, recovery, delivery, and evidence.

| What you need done | How XiaoBa takes over | What comes back |
| --- | --- | --- |
| Change code, fix a bug, verify a build | EngineerCat works inside the repository and engineering environment | Code changes, test results, and artifact evidence |
| Browse sites, collect research, verify a page | BrowserCat works through a bounded browser driver | Structured results, sources, and page evidence |
| Operate a desktop application | GuiCat works through a macOS GUI driver | Action results and GUI evidence |
| Work with Feishu calendars, messages, tasks, and docs | SecretaryCat delegates workflows to the official `lark-cli` | Feishu results, files, and delivery evidence |
| Review a new skill or role | UserCat applies pressure, InspectorCat investigates, ReviewerCat replays | An Arena scorecard and an explicit decision |

Runtime state, traces, and artifact evidence stay local by default. Model providers can be configured through OpenAI-compatible, Anthropic, Ollama, or other compatible endpoints.

## How It Works

```text
CLI / Feishu / WeChat / Pet / Dashboard
                    |
                    v
    Base Main Agent: conversation and dispatch
                    |
                    v
     Role Subagent: specialist background work
                    |
                    v
        Tools / Drivers / Files / Messages
                    |
                    v
      Deliverables + Trace + Replay + Scorecard
```

- **One control plane**: Base is the only user-facing main agent; all seven roles reuse the XiaoBa Agent loop.
- **Background dispatch**: role subagents take long-running work while the main conversation remains interactive.
- **Deterministic capability boundaries**: browser, GUI, and Feishu drivers provide capabilities without starting another Chat, Agent, or MCP loop.
- **Deliverable-first completion**: files, messages, and tool results become structured evidence; “the model said it finished” is not completion.
- **Local replayability**: traces, artifacts, deliveries, replay, and scorecards form an inspectable evidence chain.

## Runtime Dashboard

<p align="center">
  <img src="assets/dashboard.png" alt="XiaoBa Runtime Dashboard with services, roles, skills, configuration, store, and Chat" width="100%">
</p>

<p align="center"><sub>The Electron Dashboard brings runtime services, roles, skills, configuration, the store, and Chat into one local entry point.</sub></p>

## Seven Default Roles

The Base Main Agent owns user communication, judgment, and dispatch. Roles are specialist background subagents, not seven independent agent frameworks.

| Role | Responsibility |
| --- | --- |
| UserCat | Pressures candidate capabilities with low-information, realistic user behavior and produces candidate traces |
| InspectorCat | Finds problems in traces, tool facts, and artifacts; preserves evidence and routes repairs |
| ReviewerCat | Runs multi-attempt replay and returns `pass / unstable / reopened / blocked / unsafe` |
| EngineerCat | Owns code, repositories, builds, and Inspector/Reviewer repair work |
| BrowserCat | Takes over browser tasks through bounded, verifiable page operations |
| GuiCat | Takes over macOS desktop GUI tasks |
| SecretaryCat | Takes over Feishu workflows; `FeishuCat` is an alias and official `lark-cli` supplies domain capabilities |

## Quick Start

### macOS Desktop Preview

[Download XiaoBa v0.1.1 for macOS](https://github.com/fightheyyy/XiaoBa-CLI/releases/tag/v0.1.1)

- The current DMG targets Apple Silicon (arm64).
- It is a public technical preview, not a signed and notarized stable release.
- See the release notes for the checksum, source commit, and known limitations.

### CLI / Source

Node.js 18 or newer is required:

```bash
git clone https://github.com/fightheyyy/XiaoBa-CLI.git
cd XiaoBa-CLI
npm install
cp .env.example .env
```

Configure a model in `.env`:

```env
XIAOBA_LLM_PROVIDER=openai
XIAOBA_LLM_API_BASE=https://api.openai.com/v1
XIAOBA_LLM_API_KEY=your_api_key
XIAOBA_LLM_MODEL=your_model
```

Start the interactive CLI:

```bash
npm run dev -- chat -i
```

Start with a specific role:

```bash
npm run dev -- chat -r engineer-cat -i
```

Start the Electron Dashboard:

```bash
npm run electron:dev
```

See [`requirement.txt`](requirement.txt) for role-specific CLI and platform dependencies used by BrowserCat, GuiCat, SecretaryCat, and other roles. Install and authorize them only when you need the corresponding role.

## Evidence & Evaluation

XiaoBa turns “done” into inspectable facts instead of relying on a plausible-looking response.

| Evidence layer | Current purpose |
| --- | --- |
| Trace | Records model, tool, failure, delivery, and runtime-event facts for one user request |
| Artifact / Delivery Evidence | Records files, messages, external receipts, and actual delivery outcomes |
| Trace Replay | Drives the current runtime from historical user intent to observe behavioral changes |
| Live Agent Eval | Fresh-runs the current runtime on curated cases and applies hard verifiers |
| Arena | Reviews candidate skills and roles in a clean runtime and emits an auditable scorecard |

BaseRuntime currently maintains 11 fresh-run live cases. Arena also calibrates UserCat, InspectorCat, and ReviewerCat against seven SkillsBench-derived controlled cases. This supports only a narrow claim about those controlled samples; it is not evidence that every provider, skill, or future version is stable.

```bash
npm test
npm run replay:trace
npm run eval:base-runtime
npm run check:benchmarks
```

See the [Evaluation SPEC](docs/evaluation/SPEC.md) and [Arena Calibration Evidence](docs/arena/SPEC.md#calibration-evidence) for the claim boundaries. Recent verification status lives only in the [Project PLAN](docs/PLAN.md), so README numbers do not become a stale changelog.

## Arena: Review Capabilities Before Trusting Them

Arena does not trust a skill because its instructions look convincing. A candidate enters an isolated clean runtime, goes through realistic UserCat use, InspectorCat evidence extraction, and ReviewerCat multi-attempt replay, then receives a `pass`, `unstable`, `reopened`, `blocked`, or `unsafe` decision.

```bash
xiaoba arena skill <skill-name>
```

Arena supports exactly three review modes: `base + skill`, `role + skill`, and `role`. Promotion is an explicit human action; Arena does not automatically mutate production `skills/` or role registration.

## Current Boundaries

- The macOS Electron DMG remains an unnotarized Apple Silicon preview.
- BrowserCat, GuiCat, and SecretaryCat depend on pinned or official external drivers/CLIs and require the corresponding installation, permissions, or login state.
- Dashboard, Pet, and Bridge control surfaces are currently intended for local use and do not yet have complete authentication and Owner authorization for untrusted networks.
- Trace Replay can execute current real side effects. Do not batch-replay arbitrary historical traces without review until side-effect isolation is complete.

## Common Commands

| Goal | Source development | CLI bin |
| --- | --- | --- |
| Interactive chat | `npm run dev -- chat -i` | `xiaoba chat -i` |
| Single message | `npm run dev -- chat -m "summarize this repo"` | `xiaoba chat -m "summarize this repo"` |
| Role chat | `npm run dev -- chat -r engineer-cat -i` | `xiaoba chat -r engineer-cat -i` |
| Review a skill | `npm run dev -- arena skill <skill-name>` | `xiaoba arena skill <skill-name>` |
| Dashboard | `npm run electron:dev` | - |
| Build | `npm run build` | - |
| Test | `npm test` | - |

## Docs & Community

- [Project Architecture](docs/SPEC.md)
- [Project Status / Plan](docs/PLAN.md)
- [Roles Guide](roles/README.md)
- [Skills Guide](skills/README.md)
- [Releases](https://github.com/fightheyyy/XiaoBa-CLI/releases)
- [Discussions](https://github.com/fightheyyy/XiaoBa-CLI/discussions)
- [Issues](https://github.com/fightheyyy/XiaoBa-CLI/issues)

## License

[Apache-2.0](LICENSE)
