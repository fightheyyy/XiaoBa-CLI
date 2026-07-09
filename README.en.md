<div align="center">
  <img src="assets/hero.gif" alt="Message your work. XiaoBa works like a teammate." width="100%">

  # XiaoBa-CLI

  **An IM-native AI coworker runtime.**

  Human-like delivery, async subagents, and replay eval traces for work that should be observable after it happens.

  `CLI / Dashboard / Desktop Pet / Feishu / WeChat`<br>
  `Human-like Reply / Async Subagents / Roles & Skills`<br>
  `Trace / Replay / Scorecard / Agentic Eval`

  > Work like a teammate. Leave traces like infrastructure.

  [![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
  [![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](package.json)
  [![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)](https://github.com/fightheyyy/XiaoBa-CLI)

  [简体中文](README.md) · [Quick Start](#quick-start) · [Arena](#arena) · [Evidence](#evidence) · [Docs](#docs)
</div>

---

## What XiaoBa Does

XiaoBa-CLI is not trying to be another smarter chatbot. It is an **IM-native AI coworker runtime**: users send work through IM, CLI, Dashboard, or Desktop Pet; XiaoBa accepts the job, dispatches work, runs in the background, collects evidence, and delivers the result back.

It is built around four ideas:

1. **Human-like delivery**: short feedback, no raw tool-log spam, confirmation when needed, and quiet background work when possible.
2. **Subagents / roles**: the main agent owns the conversation and dispatches long-running work to role-specific subagents, so IM chat stays unblocked.
3. **Observable / replayable / evaluable / regression-safe work**: every job leaves traces, tool results, artifacts, replay data, and scorecards.
4. **Agentic Eval**: XiaoBa includes an early local Arena for capability review; the fuller CI for agents path will move to Barena: `Agents can grow. Barena makes growth reviewable.`

Core flow:

```text
IM / CLI / Dashboard / Pet -> XiaoBa Runtime
  -> main agent -> role / subagent
  -> tools / files / messages
  -> trace / replay / scorecard
```

XiaoBa makes AI coworkers useful for long-running work. Arena / Barena makes capability changes reviewable, replayable, and scoreable.

## Why It Is Different

- **IM-native**: not a one-shot CLI prompt, but a runtime for message surfaces, long conversations, and long-running work.
- **Coworker-like**: users see short feedback and deliverables, not verbose process narration or raw tool logs.
- **Async dispatch**: subagents / roles can take over background work while the main conversation stays interactive.
- **Replay eval**: traces, artifacts, replay, and scorecards form an inspectable evidence chain.

## Quick Start

```bash
git clone https://github.com/fightheyyy/XiaoBa-CLI.git
cd XiaoBa-CLI
npm install
cp .env.example .env
```

Configure a model provider in `.env`:

```env
XIAOBA_LLM_PROVIDER=openai
XIAOBA_LLM_API_BASE=https://api.openai.com/v1
XIAOBA_LLM_API_KEY=your_api_key
XIAOBA_LLM_MODEL=your_model
```

Source development:

```bash
npm run dev -- chat -i
npm run dev -- chat -r engineer-cat -i
```

After package install or `npm link`:

```bash
xiaoba chat -i
xiaoba chat -r engineer-cat -i
```

Start the desktop Dashboard:

```bash
npm run electron:dev
```

## Arena / Barena

XiaoBa includes an early local Arena module for skill / role capability review. Evaluate an installed skill:

```bash
xiaoba arena skill <skill-name>
```

Equivalent source-development command:

```bash
npm run dev -- arena skill <skill-name>
```

Arena has three core review modes:

| Mode | Goal |
| --- | --- |
| `base + skill` | Evaluate whether a skill works in the cleanest base runtime |
| `role + skill` | Evaluate whether a skill remains reliable inside a specific role |
| `role` | Evaluate whether a role itself is reliable |

The fuller Agentic Eval / CI for agents path will move to Barena:

```text
Agents can grow.
Barena makes growth reviewable.
```

## Default Capabilities

The default package keeps only the minimum trusted core:

- Roles: `user-cat`, `inspector-cat`, `engineer-cat`, `reviewer-cat`
- Skills: `remember`, `agent-browser`, `skill-publish`, `role-publish`, `self-evolution`

Additional roles and skills enter through explicit installation, and should pass Arena or human review before becoming trusted.

## Evidence

Arena currently has live proof on 7 SkillsBench-derived external gold cases: 2 baseline cases plus 5 broad holdout cases, with false pass = 0. The full proof corpus is not shipped in the XiaoBa-CLI repo; it belongs in a local ignored data directory or a separate evaluation corpus.

This proves that the current `UserCat -> InspectorCat -> ReviewerCat` loop can preserve real evidence, extract issues/cases, run multi-attempt replay, and avoid false pass when an external verifier fails or replay is unstable. It does not claim that every skill is already stable, or that the result fully generalizes across providers and time windows.

Full proof boundaries:

- [Cat Effectiveness Technical Report](docs/arena/CAT_EFFECTIVENESS_REPORT.md)
- [Arena Effectiveness Experiment](docs/arena/ARENA_EFFECTIVENESS_EXPERIMENT.md)

## Common Commands

| Goal | Source development | CLI bin |
| --- | --- | --- |
| Interactive chat | `npm run dev -- chat -i` | `xiaoba chat -i` |
| Single message | `npm run dev -- chat -m "summarize this repo"` | `xiaoba chat -m "summarize this repo"` |
| Role chat | `npm run dev -- chat -r engineer-cat -i` | `xiaoba chat -r engineer-cat -i` |
| Evaluate a skill | `npm run dev -- arena skill <skill-name>` | `xiaoba arena skill <skill-name>` |
| Dashboard | `npm run electron:dev` | - |
| Build | `npm run build` | - |
| Test | `npm test` | - |

## Docs

The README is the first-glance product entry. Detailed architecture, module boundaries, and long-term plans live in docs.

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
