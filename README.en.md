<div align="center">
  <img src="assets/hero.gif" alt="Agents can grow. XiaoBa makes growth reviewable." width="100%">

  # XiaoBa-CLI

  **Governed Self-Improving Agent Runtime.**

  XiaoBa lets agents accumulate skills, reuse experience, and grow over time. More importantly, it makes every growth step reviewable with traces, replay, and Arena scorecards.

  > Agents can grow. XiaoBa makes growth reviewable.

  [![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
  [![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](package.json)
  [![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)](https://github.com/fightheyyy/XiaoBa-CLI)

  [简体中文](README.md) · [Quick Start](#quick-start) · [Arena](#arena) · [Evidence](#evidence) · [Docs](#docs)
</div>

---

## What XiaoBa Does

Many agents can "generate skills" or summarize experience. The hard problem is whether that growth is reliable, whether it regresses later, and whether humans can inspect, replay, and govern it.

XiaoBa turns self-evolution into a governed loop:

```text
skill / role candidate
  -> clean runtime
  -> real multi-turn use
  -> native trace / artifacts
  -> issue extraction
  -> replay / verifier / scorecard
  -> pass / unstable / reopened / blocked / unsafe
```

This is not another chatbot shell. XiaoBa's goal is:

```text
Agents can grow.
XiaoBa makes growth reviewable.
```

## Why It Is Different

- **Runtime**: Give agents a working body: roles, skills, tools, subagents, memory, files, delivery, and session state cooperate inside one recoverable runtime.
- **Evidence**: XiaoBa records more than model text: real tool calls, file artifacts, user-visible delivery, session traces, and artifact evidence.
- **Replay**: Historical real sessions can drive the current runtime again to catch regressions, fake success, missing artifacts, and unstable behavior.
- **Arena**: New skills, new roles, and self-evolution outputs are untrusted candidates by default; Arena runs them in a clean runtime, lets UserCat perform real multi-turn use, then asks InspectorCat to extract cases and ReviewerCat to replay and score them.

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

## Arena

Evaluate an installed skill:

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

## Default Capabilities

The default package keeps only the minimum trusted core:

- Roles: `user-cat`, `inspector-cat`, `engineer-cat`, `reviewer-cat`
- Skills: `remember`, `agent-browser`, `skill-publish`, `role-publish`, `self-evolution`

Additional roles and skills enter through explicit installation, and should pass Arena or human review before becoming trusted.

## Evidence

Arena currently has live proof on 7 SkillsBench-derived external gold cases: 2 baseline cases plus 5 broad holdout cases, with false pass = 0. The full proof corpus is not shipped in the XiaoBa-CLI repo; it belongs in Barena or a local ignored data directory.

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
