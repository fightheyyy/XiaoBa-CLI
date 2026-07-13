# Evaluation SPEC

状态：Active
最后更新：2026-07-13
适用范围：历史 Trace Replay、Live Agent Eval、benchmark source、verifier 和 scorecard gate。

本文是 XiaoBa-CLI 六个顶层模块之一 `Evaluation` 的唯一架构真相源。它同时定义 Engineering Test、Trace Replay 和 Live Agent Eval 的边界；前者验证代码，Replay 回答“同款历史输入现在会发生什么”，Live Agent Eval 回答“curated benchmark 是否通过”。

## Problem

Agent 的历史 trace、工程测试、真实行为复跑和 benchmark scorecard 都有价值，但不能都叫 eval：

- Trace Replay 是本地排障和回归观察，不给能力打最终分。
- Live Agent Eval 必须重新驱动当前 runtime，验证新产生的 tool/result/artifact/delivery evidence，并输出 scorecard。
- Unit、integration 和 deterministic contract smoke 属于 `test/`，不属于 Evaluation gate。
- Arena 验收候选 skill / role 的可信度，不自动接纳 benchmark source。

## Scope

In scope:

- `src/replay/**`、`src/commands/replay.ts`、`scripts/run-trace-replay.ts`。
- `src/eval/**`、`eval/**`、`scripts/run-eval-*.ts`。
- historical trace input extraction、fresh runtime rerun 和 lightweight comparison。
- curated live benchmark setup、replay、hard verifier、report 和 scorecard。
- `npm run replay:trace`、`npm run eval:base-runtime`、`npm run eval:gate`、`npm run check:benchmarks`。

Out of scope:

- Unit、integration、contract smoke 和 deterministic runtime checks 位于 `test/**`，但语义边界由本文统一维护。
- 原始 trace、artifact 和 delivery evidence 的事实源，属于 [`../observability-evidence/SPEC.md`](../observability-evidence/SPEC.md)。
- 外部 skill / 本地 role 的候选接入和可信验收，属于 [`../arena/SPEC.md`](../arena/SPEC.md)。
- 自动把 observability proposal、Replay output 或 Arena run 接纳为 benchmark source。

## Current Architecture

当前两条主线已经物理分开。Trace Replay 读取历史 `traces.jsonl`，重新驱动当前 Pet/Chat runtime 并输出 fresh trace 和轻量比较；Live Agent Eval 当前只保留 BaseRuntime 11 条 live case，通过 `surface_runtime` 产生新证据并运行 hard verifiers。

```mermaid
flowchart LR
    subgraph ReplayLane["Trace Replay：历史输入复跑"]
        OldTrace["logs/sessions/**/traces.jsonl"]
        Extract["extract user.text"]
        CurrentRuntime["current Pet / Chat runtime"]
        FreshTrace["fresh trace / visible history"]
        Compare["lightweight comparison"]
    end

    subgraph EvalLane["Live Agent Eval：curated benchmark"]
        Manifest["eval/benchmarks manifest"]
        Cases["BaseRuntime live cases"]
        SurfaceReplay["surface_runtime replay"]
        Evidence["fresh tool / artifact / delivery evidence"]
        Verify["hard verifiers"]
        Scorecard["scorecard / report"]
    end

    OldTrace --> Extract
    Extract --> CurrentRuntime
    CurrentRuntime --> FreshTrace
    FreshTrace --> Compare

    Manifest --> Cases
    Cases --> SurfaceReplay
    SurfaceReplay --> Evidence
    Evidence --> Verify
    Verify --> Scorecard
```

## Target Architecture

目标架构保持两条窄主线，不重新引入中心化 schema/rubric/governance 平台。Replay output 只能经人工整理成为 curated case；Live Agent Eval 只接纳能重新运行当前 agent/runtime 的 case。

```mermaid
flowchart LR
    subgraph Sources["Sources"]
        Historical["historical local trace"]
        Curated["curated benchmark case"]
    end

    subgraph Evaluation["Evaluation module"]
        Replay["Trace Replay<br/>fresh rerun + comparison"]
        LiveEval["Live Agent Eval<br/>setup + fresh behavior"]
        Verifier["task / safety / evidence verifiers"]
    end

    subgraph Outputs["Outputs"]
        ReplayReport["local replay report"]
        Scorecard["benchmark scorecard"]
    end

    Historical --> Replay
    Replay --> ReplayReport
    ReplayReport -. "human curation only" .-> Curated
    Curated --> LiveEval
    LiveEval --> Verifier
    Verifier --> Scorecard
```

## Stable Boundaries

- Trace Replay 不属于 `eval:*` 命令面，不输出 benchmark pass/fail。
- Live Agent Eval case 必须 fresh-run 当前 runtime；只读旧 trace 或旧 artifact 的检查不是 live eval。
- Replay、Observability 和 Arena 都不能自动写入 accepted benchmark source。
- `test/` 是独立工程验证边界；它可以验证 Evaluation 的代码，但不属于 Evaluation gate。
- `check:benchmarks` 只做 manifest/case/suite preflight，不冒充行为评测。
- 当前 release eval 只聚合 BaseRuntime；未来 role benchmark 必须有输入、setup、fresh replay、expected result、hard verifiers 和 scorecard。

Minimum live case shape:

- Stable case id and user request.
- Deterministic setup/fixture instructions.
- A replay adapter that drives the current production runtime path.
- Expected user-visible, tool, artifact or delivery outcome.
- Task-specific hard verifiers; prose similarity alone is insufficient.
- Generated scorecard that records every declared hard verifier.

## Implementation Layout

```text
test/                         unit / integration / deterministic smoke
src/replay/                   historical trace replay runner
scripts/run-trace-replay.ts   replay command adapter
src/eval/                     live eval runner / gate
eval/benchmarks/              curated live benchmark source
output/replay/                generated replay output
output/eval/                  generated eval output
```

Stable command meanings:

- `npm test` and `npm run test:*`: code correctness and deterministic contracts.
- `npm run replay:trace`: historical input rerun with fresh evidence; no benchmark verdict.
- `npm run eval:base-runtime`: current BaseRuntime live cases.
- `npm run eval:gate`: live agent eval aggregation only.
- `npm run check:benchmarks`: manifest/case/suite reference preflight only.

## Interaction With Other Modules

- Agent Runtime 提供当前被复跑的 AgentSession、ConversationRunner 和 ToolManager。
- Surface 提供 Pet/Chat 等真实入口。
- Observability & Evidence 提供历史输入和 fresh evidence 的本地事实源。
- Roles & Skills 提供被评测的 Base/Role/Skill 策略。
- Arena 可以引用 Evaluation 结果，但不能自动改变 Evaluation source。
