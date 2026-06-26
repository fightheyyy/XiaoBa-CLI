# XiaoBa-CLI PLAN

状态：Active
最后更新：2026-06-27
Owner：XiaoBa maintainers

本文维护 XiaoBa-CLI 仓库级执行计划。`docs/SPEC.md` 定义项目级架构和 contract，本文维护当前状态、下一步、验收条件和验证证据。五个顶层架构模块是 Surface、Agent Runtime、Roles & Skills、Observability & Evidence、Evaluation；Evaluation 当前只承认两条产品主线：Trace Replay 和 Live Agent Eval。`test/` 是独立工程验证边界，不是 Evaluation gate。更细的 durable 子模块可以继续维护自己的 `SPEC.md` / `PLAN.md`。

## Current Status

2026-06-23：仓库级架构口径收敛为五个顶层模块：Surface、Agent Runtime、Roles & Skills、Observability & Evidence、Evaluation。Evaluation 不再把所有 trace 相关东西都叫 eval，只保留两条主线：Trace Replay 负责“历史真实用户输入重新跑当前 runtime 并产出 fresh trace 对比”，Live Agent Eval 负责“curated benchmark case + verifier + scorecard”。`test/` 是 unit / integration / deterministic contract smoke 边界，不再通过 `eval-smoke` 二次包装进 eval benchmark portfolio；`eval/` 只负责 live agent eval benchmark。`eval:gate` 默认只聚合 BaseRuntime live agent eval。Observability & Evidence 只保留本地 trace / event / metric / artifact evidence；外部观测导出和本地 trace/log 清洗策略已退出当前实现。

```mermaid
flowchart LR
    subgraph Test["Test Harness"]
        Unit["unit / integration"]
        Smoke["contract / JSONL / surface runtime / provider smoke"]
    end

    subgraph Eval["Eval / Benchmark"]
        Replay["Trace Replay"]
        BaseRuntime["BaseRuntime benchmark"]
        LiveOnly["live replay cases only"]
    end

    subgraph Evidence["Observability Evidence System"]
        Trace["trace / event / metric"]
        Artifact["artifact evidence"]
        LocalSummary["local summary"]
        Continuity["trace continuity"]
    end

    Unit --> LocalChecks["local checks"]
    Smoke --> LocalChecks
    Trace --> Replay
    Replay --> LocalChecks
    BaseRuntime --> Gate["eval:gate agent eval"]
    LiveOnly --> Gate
    Trace --> BaseRuntime
    Artifact --> BaseRuntime
    LocalSummary --> LocalChecks
    Continuity --> LocalChecks
```

已完成：

- `src/replay` / `scripts/run-trace-replay.ts` 是 Trace Replay 主线：读取历史 `traces.jsonl`，抽取用户输入，重新驱动当前 Pet/Chat runtime，产出 fresh trace 和轻量对比。
- `src/eval/gate-runner.ts` 只保留 BaseRuntime live agent eval item；runtime-harness/test suites 已移出 eval gate，由 `scripts/run-contract-smoke.ts` 和 `scripts/run-test-suite.ts` 承担。
- `package.json` 和 eval contracts 已删除旧中心化 gate / governance / source-acceptance 默认入口；`.github/workflows` 已移除，质量检查现在靠本地脚本/手动运行；`test:*` owns contract-smoke scripts，`eval:*` owns live agent eval scorecards，`eval:base-runtime` 不接受任意 benchmark path override。
- `src/eval` 的 runnable replay 模式只保留 `surface_runtime`；低层 `conversation_runner`、`agent_session` 和 `surface_adapter` replay suites / scripts 已退出当前命令面。
- `eval/benchmarks/eval-smoke` 已删除；`eval/benchmarks/BaseRuntime` 是当前唯一 eval benchmark root，通过单一 `runtime-benchmark.jsonl` 覆盖 11 条 live Pet/runtime cases；旧 100 条 structural trace regression、RoleArena、UserCat、ResearcherCat、EngineerCat、contracts、rubrics 和 schemas 已从 `eval/` 删除。
- 顶层 `tests/` 已迁到 `test/`；`test/contract-smoke/suites` 和 `test/contract-smoke/fixtures` 已收窄为 runtime harness 输入；旧 role behavior suites / fixtures 已从 active `eval/` 边界删除，未来只有重写成 live agent replay 的 role benchmark 才能回到 `eval/benchmarks/<Role>/`。
- Dashboard observability action API 已退出当前产品路径；观测层只保留本地 summary/review 读接口，Trace Replay 和 Live Agent Eval 是唯一评测体系入口。
- Dashboard legacy Inspector hook/server/MySQL 配置面已退出当前产品路径；InspectorCat 保留 `analyze_log` 取证工具，旧 hook runtime/API auto-start 等待 Inspector refactor 重新定义合同。
- 旧中心化 eval/governance/source-acceptance 文件级资产已物理删除。
- Heavy eval schema governance has been removed from the active path; benchmark assets now use `check:benchmarks` for live-only manifest/case/suite preflight.
- `Guide` 保留为 ChinaTravel / TPC competition role，并拥有 role-local spec/plan、data/eval skills、`guide_tpc_baseline` / `guide_tpc_env_baseline` / `guide_tpc_eval_analysis` runtime tools、1000 Phase 1 v12 repaired predictions、official scorecard 和 stage-level eval analysis evidence；旧 role-wide gate 已退出 active eval 命令面，未来 Guide/role eval 必须按 live agent eval 形态重建后才能进入 `eval/benchmarks/<Role>/`。

部分完成：

- 各 role 的旧静态/混合 benchmark assets 已从 `eval/` 删除；后续 role eval 只有重写成 live agent replay 后才能回到 `eval/benchmarks/<Role>/`。
- Observability 现在是本地优先证据系统：session JSONL 投影到 local summary，AgentSession 路径以 session JSONL 作为 local summary 事实源。这些证据可被 Trace Replay、BaseRuntime live eval 或未来 role-owned live benchmark 消费，但不能自动变成 accepted benchmark source。
- Session/trace/turn 术语已统一到 live log 主路径：`session` 是长期会话，`trace` 是一次用户请求到本次 `ConversationRunner` while-loop 截止，`turn` 保留给 while-loop 内部推进；新 live log 写入 `entry_type="trace"`、`trace_id`、`trace_index`，并把 lifecycle/provider events 嵌入 trace row。
- Surface adapter/runtime/file smoke 仍属于 runtime harness；完整真实入口 E2E 应交给 ReviewerCat / role benchmark 分层推进。

未开始或仍需收敛：

- Dashboard/Pet 网络暴露面的权限、鉴权和 command/path validation 仍需单独加固。
- durable background job / subagent persistence 仍未形成完整 runtime contract。
- ReviewerCat 的统一 ReviewTaskRunner、future role E2E scorecard 合并器和 provider transcript 深度 verifier 仍是后续主线。
- Role benchmark 需要重新按 live agent eval shape 设计，不能把静态 trace fixture 或 rubric-only 文件放回 `eval/`。

## Milestones

1. M0：Spec / Plan governance baseline：completed for root, top-level module docs, eval docs, benchmark docs and maintained role docs.
2. M1：Test / Eval physical boundary：completed for top-level `test/`, `test:contract-smoke`, `check:benchmarks`, `eval:base-runtime`, local quality command boundaries, and runtime-only `test/contract-smoke/suites` / `test/contract-smoke/fixtures`.
3. M2：Live eval boundary：completed for current `eval/`; only BaseRuntime live replay remains under `eval/benchmarks`.
4. M3：Trace Replay boundary：completed for first-class Pet/Chat trace replay runner and command entrypoint.
5. M4：Observability & Evidence：partial; external exporter mirror and local trace/log policy cleanup have been removed from the current local-first implementation; session-log projection and durable state/evidence docs remain.
6. M5：Surface runtime harness：partial; adapter/runtime/file smokes remain in runtime harness, while production-network full E2E belongs to ReviewerCat / role benchmark ownership.
7. M6：Permission and control-plane security boundary：not started for network-exposed Dashboard/Pet control surfaces.
8. M7：Durable session / background job state：partial for surface-scoped restore and visible-history refs; durable background job persistence remains incomplete.

## Next Steps

- Put new deterministic correctness checks in `test/`; put only live agent eval source in `eval/`.
- Use `replay:*` / `xiaoba replay --trace` for historical trace reruns; do not call historical trace rerun `eval`.
- Keep new eval work inside BaseRuntime live eval or a future role-owned live replay benchmark.
- Do not add old central eval/governance/source-acceptance pipelines back into package scripts、GitHub workflows、contracts、schemas、rubrics or default gates.
- Move any future role-specific eval additions into the owning role benchmark directory only after they have input、setup、replay、expected tool/result and verifiers; deterministic runtime harness stays in `test/contract-smoke`.
- Keep observability evidence read-only: accepted benchmark source must be authored explicitly by runtime harness or role benchmark maintainers, not generated by observability.
- Keep unifying Observability & Evidence around session JSONL as the local truth: remaining direct metric writers must be explicit standalone-runner or mirror-only paths.
- Keep historical session-log-v2 fixtures readable while new live logs use the session-log-v3 directory layout.
- Fix permission and auth boundaries before expanding network-exposed Dashboard/Pet control surfaces.
- Keep role-tool artifact checks in test/runtime ownership, not under `eval/contracts`.
- Extend live state-boundary coverage to future maintained surfaces only after each surface has stable persisted visible-history refs.
- Add an explicit long-term memory recall command/tool if product UX needs memory lookup beyond automatic lifecycle extraction.
- Rebuild EngineerCat / all-roles / skill handoff / cross-role eval only as live agent eval cases before reintroducing them under `eval/`.
- Keep Guide repair work under role-owned docs/evidence: current next order is chronology repair, budget / inner-city transport solving, verifier-filtered intercity mode repair, residual entity repair, reproducible data profiling, then LLM/SFT/RL only after deterministic verifier overlap plateaus.
- Add SecretaryCat focused runtime/test coverage once Feishu auth/calendar/message wrappers have manual smoke evidence; only add eval coverage later as live agent replay.
- Connect ReviewerCat to UserCat candidate packages as a read-only curation/review workflow; accepted benchmark additions still belong to role benchmark owners.

## Owners

- Runtime harness：`src/core/**`
- Surface：`src/commands/**`, `src/feishu/**`, `src/weixin/**`, `src/pet/**`, `src/dashboard/**`
- Provider adapters：`src/providers/**`
- Tool boundary：`src/tools/**`, `src/types/tool.ts`
- Roles：`roles/**`, `src/roles/**`
- Skills：`skills/**`, `src/skills/**`
- Observability & Evidence：`src/observability/**`, `logs/**`, `data/**`, `memory/**`, `output/**`, `docs/observability-evidence/state-evidence/**`
- Evaluation strategy and execution：`eval/**`, `eval/benchmarks/**`
- Test verification boundary：`test/**`
- Documentation governance：`docs/SPEC.md` / `docs/PLAN.md` and module SPEC/PLAN owners.

## Acceptance Criteria

- `docs/SPEC.md` and `docs/PLAN.md` exist and stay in sync as the project-level source of truth.
- The architecture module specs exist and stay discoverable from `docs/SPEC.md`: `docs/surface/SPEC.md`, `docs/agent-runtime/SPEC.md`, `docs/roles-skills/SPEC.md`, `docs/observability-evidence/SPEC.md`, `docs/trace-replay/SPEC.md`, and `docs/evaluation/SPEC.md`. `docs/evaluation/SPEC.md` remains a proxy to the real `eval/SPEC.md` control-plane source; `docs/trace-replay/SPEC.md` owns historical trace replay; `docs/observability-evidence/state-evidence/SPEC.md` remains the durable evidence subdocument under Observability & Evidence, and `test/SPEC.md` remains the deterministic verification boundary under Evaluation.
- The `eval/` durable module has `SPEC.md` and `PLAN.md`, and remains clearly scoped as evaluation strategy/control-plane docs rather than raw trace or replay output storage.
- The `test/` durable module has `SPEC.md` and `PLAN.md`, and remains clearly scoped as unit / integration / contract smoke rather than role behavior benchmark.
- Every substantial long-lived module has `SPEC.md` and `PLAN.md`, or a documented reason why it is still a small utility.
- Every substantial `SPEC.md` includes `Current Architecture` and `Target Architecture` Mermaid diagrams.
- Any production architecture change updates the relevant current diagram and plan status in the same change.
- A milestone is marked complete only when code, docs, and verification evidence support it.
- Security-sensitive surfaces have explicit auth, permission, and command/path validation boundaries before being treated as network-ready.
- Default benchmark portfolio sources pass manifest loading and case-reference preflight before becoming gate evidence.

## Verification Log

- 2026-06-25：Non-Room PR follow-up closed the remaining delivery/UI/docs review findings: Feishu text send failures now propagate into failed delivery evidence, main Dashboard pet Chat sends/replays with role-scoped `sessionKey`, message-mode channel replies render as separate visible messages, ReviewerCat writeback wording matches current runtime capability, and README role spec links point to existing files. Verification：`npm ci`；`npm run build`；`npm test`（358/358）；`npm run test:contract-smoke`（6/6 items，23/23 cases）；`npm run check:benchmarks`（1 manifest，11 cases）；`npm run eval:base-runtime`（11/11 benchmark cases，11/11 eval cases）；`npm run eval:gate`（1/1 item，11/11 cases）；`git diff --check`。
- 2026-06-25：Non-Room PR follow-up restored release eval and production delivery/security contracts: BaseRuntime Pet fixtures now use valid role-base session keys, benchmark preflight validates Pet payloads, Weixin delivers `finalResponseVisible` text through channel callbacks, and Dashboard summary redacts sensitive blocked-reason values. Verification：`npm run build`；`npm test`（354/354）；`npm run test:contract-smoke`（6/6 items，23/23 cases）；`npm run check:benchmarks`（1 manifest，11 cases）；`npm run eval:base-runtime`（11/11 benchmark cases，11/11 eval cases）；`npm run eval:gate`（1/1 items，11/11 cases）；`git diff --check`。
- 2026-06-23：Trace Replay 成为独立产品主线：新增 `src/replay` runner、`xiaoba replay --trace`、`npm run replay:trace`、trace replay module docs，把 `eval/` 口径收窄为 Live Agent Eval benchmark，并移除旧 trace-proposal / trace-continuity 观测 action 路径。Verification：`node --test -r tsx test/trace-replay-runner.test.ts`；`node --test -r tsx test/dashboard-observability-api.test.ts`；`npm run build`；`npm run check:benchmarks`；`npm run replay:trace -- --help`；`node dist/index.js replay --help`；真实 Pet trace one-turn smoke 产出 `output/replay/manual-smoke-userboundary20-one-final`、fresh trace / visible history / comparison report。
- 2026-06-23：Removed low-level replay execution from eval/test: accepted replay mode is now `surface_runtime` only; `conversation_runner` / `agent_session` / `surface_adapter` replay scripts, suites, tool simulator, adapter-only verifier and tests were deleted. Verification：`npm run build`；`npm run check:benchmarks`（1 manifest，11 cases）；`npm run eval:base-runtime`（11/11 benchmark cases，11/11 eval cases）；`npm run eval:gate`（1/1 items，11/11 cases）；`npm run test:contract-smoke`（6/6 items，28/28 cases）；`node --test -r tsx test/eval-gate.test.ts test/eval-benchmark-bridge.test.ts test/eval-runner.test.ts test/provider-network-readiness-runner.test.ts`（42/42）；`npm test`（360/360）；`git diff --check`。
- 2026-06-23：Test/Eval execution boundary hardened: `test:*` now uses test-owned runners, `src/eval/gate-runner.ts` only runs BaseRuntime live agent eval, `eval:base-runtime` no longer accepts arbitrary benchmark path overrides, and `check:benchmarks` enforces live replay metadata/suite cases. Verification：`npm run build`；`npm run check:benchmarks`（1 manifest，11 cases）；`npm run eval:gate`（profile=live-agent-eval，1/1 items，11/11 cases）；`npm run eval:base-runtime`（11/11 benchmark cases，11/11 eval cases）；`npm run test:contract-smoke`（10/10 items，34/34 cases）；`node --test -r tsx test/eval-gate.test.ts test/eval-benchmark-bridge.test.ts test/eval-runner.test.ts`（43/43）；negative command checks for `eval:gate -- --profile runtime-harness` and `eval:base-runtime -- --benchmark ...` failed as expected；`npm test`（364/364）；`git diff --check`。
- 2026-06-23：Cleaned stale current references to retired role-wide eval gates, `check:eval-assets`, machine-readable State/Evidence requirement portfolio IDs, `eval:engineer`, and remote release publishing from active docs/prompts/scripts. Verification：`npm run check:benchmarks`（1 manifest，11 cases）；`npm run eval:gate`（1/1 items，11/11 cases）；`npm run test:contract-smoke`（10/10 items，34/34 cases）；`npm run build`；`bash -n scripts/release.sh`；targeted retired-reference grep；`git diff --check`。
- 2026-06-23：Removed GitHub Actions workflows from `.github/workflows`; local scripts remain the quality and packaging entrypoints, and `scripts/release.sh` is local packaging only. Updated README badges/release notes and root structure docs so they no longer advertise CI or release workflows. Verification：workflow file search returned no `.github` workflow files；`git diff --check`。
- 2026-06-22：BaseRuntime 从真实 IM runtime trace 里抽出高质量 archetype，并把 5 类提升为 live Pet/runtime benchmark cases：artifact locator/resend、command recovery、path/environment recovery、user correction/latest artifact、long-work status synthesis。Verification：`npm run eval:base-runtime`（11/11 benchmark cases，11/11 eval cases）；`npm run eval:gate`（21/21 items，139/139 cases）；`npm run check:eval-assets`（18992/19003 passed，0 failed，11 skipped）。
- 2026-06-23：`eval/` 收窄为 live agent eval only；BaseRuntime benchmark source 收成 11-row `runtime-benchmark.jsonl`，删除 100 条 structural trace regression、RoleArena / UserCat / ResearcherCat / EngineerCat 静态或混合 benchmark roots，以及 `eval/contracts` / `eval/rubrics` / `eval/schemas`。Verification：`npm test`（364 passed，6 skipped）；`npm run build`；`npm run eval:base-runtime`（11/11 benchmark cases，11/11 eval cases）；`npm run eval:gate`（1/1 items，11/11 cases）；`npm run check:benchmarks`（1 manifest，11 cases）。
- 2026-06-18：BaseRuntime foundation benchmark now covers XiaoBa as an IM coding agent, not only runtime smoke. Added `base-runtime.im-coding-patch` and `base-runtime.im-subagent-goal`, plus Pet subagent callback/history evidence and deterministic subagent service injection for replay. Verification：`npm run build`; `npm run eval:base-runtime`（6/6 benchmark cases，6/6 eval cases）；`npm run check:eval-assets`（5141/5152 passed，0 failed，11 skipped）；`npm run eval:gate`（21/21 items，134/134 cases）；`git diff --check`。
- 2026-06-18：Documentation folder naming now matches the five-module architecture vocabulary. The docs root now exposes `surface`、`agent-runtime`、`roles-skills`、`observability-evidence` and `evaluation` as the only module directories. Supporting `state-evidence` lives under `docs/observability-evidence/`, benchmark proxy docs live under `docs/evaluation/`, and `docs/ROOT_STRUCTURE.md` now maps root folders back to the five modules so build output, local evidence, CI scripts and assets are not mistaken for new modules. Verification：old-doc-path grep checks passed; `git diff --check -- docs README.md eval roles test dashboard package.json .github` passed; `npm run eval:roles` passed（6/6）；`npm run check:eval-assets` passed（5141/5152 passed，0 failed，11 skipped）。
- 2026-06-18：Five-module architecture documentation sweep completed. Root docs now use Surface、Agent Runtime、Roles & Skills、Observability & Evidence、Evaluation as the only top-level architecture modules; `test/` is documented as an Evaluation verification boundary, and `docs/observability-evidence/state-evidence` is documented as an Observability & Evidence durable-source subdocument. README / role docs no longer reference retired benchmark-namespace or schema-command names, and Harness Runtime now treats `trace` as the primary user-intent unit with `episode_id` only as a legacy alias. Verification：`git diff --check -- docs README.md roles eval`; retired-command / trace-terminology grep checks; `npm run check:eval-assets`（5057/5068 passed，0 failed，11 skipped）；`npm run eval:gate`（21/21 items，132/132 cases）。
- 2026-06-17：Quality command boundary cleanup completed: public commands now use `test:*` for code/contract smoke, `eval:*` for runtime/role eval and benchmark, and `check:*` for eval asset health checks. Removed the former benchmark-namespace scripts, moved direct benchmark outputs under `output/eval/**`, and synced CI gates / curated output source contracts. Verification：`npm run build`; `node --test -r tsx test/eval-schema-validation.test.ts`（60/60）；`npm run eval:runtime`（20/20 benchmark cases，44/44 eval cases）；`npm run eval:engineer:benchmark`（5/5 benchmark cases，5/5 eval cases）；`npm run eval:researcher:benchmark`（32/32 benchmark cases，32/32 eval cases）；`npm run eval:gate`（21/21 items，132/132 cases）；`npm run check:eval-assets`（5057/5068 passed，0 failed，11 skipped）；`git diff --check`.
- 2026-06-17：Harness test cleanup removed duplicated production eval/gate/benchmark executions from ordinary `npm test`. The remaining ordinary tests cover runner/verifier/bridge/schema behavior with lightweight fixtures; full runtime/role behavior evaluation stays in `test:contract-smoke`、`eval:runtime`、`eval:gate` and `check:eval-assets`. Verification：`node --test -r tsx test/eval-gate.test.ts test/eval-benchmark-bridge.test.ts test/eval-runner.test.ts`（49/49）；`node --test -r tsx test/eval-schema-validation.test.ts`（60/60）；`npm test`（422/422）；`npm run test:contract-smoke`（10/10 items，34/34 cases）；`npm run eval:runtime`（20/20 benchmark cases，44/44 eval cases）；`npm run eval:gate`（21/21 items，132/132 cases）；`npm run check:eval-assets`（5058/5069 passed，0 failed，11 skipped）；`npm run build`; `git diff --check`.
- 2026-06-17：Channel final reply fallback changed to default-off opt-in policy. Channel surfaces now require explicit `send_text` / `send_file` for user-visible model output; direct final text remains trace/session evidence only unless `deliveryFallbackFinalReply=true` is passed. Verification：`npm run build`; focused ConversationRunner / AgentSession / observability / Pet / Dashboard Pet / eval-runner tests passed；`npm run eval:base-runtime`（1/1 benchmark case，1/1 eval case）；`npm run eval:gate`（22/22 items，130/130 cases）。
- 2026-06-17：BaseRuntime foundation stays as a single benchmark manifest and now contains four real Pet/runtime cases: work-loop evidence, delivery no-fallback, malformed tool recovery, and dangerous command blocking. `surface_runtime` replay gained explicit `capture_internal_trace` so BaseRuntime can consume internal AgentSession evidence without thickening generic surface smoke. `eval:base-runtime` is the single public command for this runtime benchmark, and gate no longer double-counts the direct suite. Verification：`npm run build`; `npm run eval:base-runtime`（4/4 benchmark cases，4/4 eval cases）；`node --test -r tsx test/eval-gate.test.ts`；`npm run eval:gate`（21/21 items，132/132 cases）；`npm run check:eval-assets`（5058/5069 passed，0 failed，11 skipped）；`git diff --check`。
- 2026-06-17：Added dedicated BaseRuntime foundation benchmark and fixed Pet multi-turn replay evidence capture. `base-runtime.pet-work-loop.001` runs two Pet messages through production `PetChannel`, writes and re-reads `runtime-evidence/base-runtime-pet-report.md`, combines surface runtime evidence with internal Pet AgentSession trace, and is exposed through `eval:base-runtime` plus role benchmark gate items. Verification：`npm run build`; `npm run eval:base-runtime`（1/1 benchmark case，1/1 eval case）；`node --test -r tsx test/eval-runner.test.ts test/eval-benchmark-bridge.test.ts test/eval-gate.test.ts test/eval-schema-validation.test.ts`（131/131）；`npm run eval:role-benchmarks`（12/12 items，96/96 cases）；`npm run eval:gate`（22/22 items，130/130 cases）；`npm run check:eval-assets`（4973/4984 passed，0 failed，11 skipped）。
- 2026-06-17：Test / eval physical boundary split landed: top-level `tests/` became `test/`, runtime deterministic smoke moved to `test/contract-smoke`, benchmark source moved under `eval/benchmarks`, package scripts split into `test:*` / `eval:*` / `check:*`, CI contract now requires `npm test`、`npm run test:contract-smoke`、`npm run eval:runtime`、role eval、gate and `check:eval-assets` eval-system validation. Verification：`npm run build`; `npm test`（440/440）；`node --test -r tsx test/eval-schema-validation.test.ts`（62/62）；`npm run test:contract-smoke`（10/10 items，34/34 cases）；`npm run eval:runtime`（20/20 benchmark cases，44/44 eval cases）；`npm run eval:role-benchmarks`（10/10 items，94/94 cases）；`npm run eval:gate`（20/20 items，128/128 cases）；`npm run check:eval-assets`（4883/4894 passed，0 failed，11 skipped）；`git diff --check`.
- 2026-06-10：Root plan language aligned with the slimmer current architecture: two eval layers plus one observability evidence system, with source acceptance owned by runtime harness or role benchmark maintainers. Verification：`node --test -r tsx test/dashboard-observability-api.test.ts test/eval-schema-validation.test.ts`（65/65）；`npm run build`；`npm run check:eval-assets`（4769/4769）；`npm run test:contract-smoke`（10/10 items，34/34 cases）；`npm run eval:role-benchmarks`（10/10 items，88/88 cases）；`git diff --check`.
- 2026-06-12：Observability unification pass made `SessionTurnLogger` / session JSONL the AgentSession local-summary source through `session-log-projector`; AgentSession-owned ConversationRunner metrics are now mirror-only to reduce local summary double-write. Verification：`npm run build`; `node --test -r tsx test/logger.test.ts test/observability.test.ts test/dashboard-observability-api.test.ts`（24/24）；`npm run eval:gate`（20/20 items，122/122 cases）；`npm run check:eval-assets`（4738/4739 passed，1 optional skip）。
- 2026-06-16：Session-log-v3 trace layout landed: `logs/sessions/<surface>/<date>/<session_id>/traces.jsonl` is the machine-readable ledger, sibling `runtime.log` is human-readable, trace rows carry embedded lifecycle/provider events, projector emits `xiaoba.trace.*`, and live state boundaries reference `session-log-v3`. Verification：`npm run build`; focused logger / AgentSession / provider-readiness / Pet / Researcher tests passed。
- 2026-06-10：Eval / benchmark ownership slimming pass moved remaining role behavior suites and fixtures out of `eval/` into `eval/benchmarks/RoleArena`, `eval/benchmarks/UserCat`, `eval/benchmarks/ResearcherCat`, and `eval/benchmarks/EngineerCat`; `check:eval-assets` now validates role-owned suites and guards `test/contract-smoke/suites` / `test/contract-smoke/fixtures` as runtime-only via `eval_source_boundary.*`. Verification：`npm run build`; `npm run eval:researcher:benchmark`（32/32 benchmark cases，32/32 eval cases）；`npm run eval:engineer:benchmark`（5/5 benchmark cases，5/5 eval cases）；`npm run eval:role-benchmarks`（10/10 items，88/88 cases）；`npm run test:contract-smoke`（10/10 items，34/34 cases）；`npm run eval:gate`（20/20 items，122/122 cases）；`npm run check:eval-assets`（4769/4769）；`node --test -r tsx test/eval-schema-validation.test.ts`（62/62）；`node --test -r tsx test/eval-runner.test.ts test/eval-benchmark-bridge.test.ts test/eval-gate.test.ts`（67/67）；`git diff --check -- docs eval benchmarks roles package.json src tests`.
- 2026-06-12：Guide Phase 1 v12 candidate exceeded the current public first-place score seen on 2026-06-12. `guide_tpc_env_baseline` now combines official environment-bound generation with official commonsense / hard-logic filtered chronology, budget-transport, route-mode, time/place, hotel-distance, cheapest-intercity, budget-prune and quote-safe entity repair. Artifacts: `output/guide/tpc-env-baseline/phase1-v12-quoteparse-full/`, zip `XiaoBaGuide_venv12.zip`, eval-analysis `output/guide/eval-analysis/phase1-v12-quoteparse-full/`; official score overall 90.3290 / FPR 93.8. Verification：`npm run build`; focused Guide/ToolManager tests; `npm run eval:all-roles`; `npm run check:eval-assets`; `git diff --check`; real v12 full run; real v12 `guide_tpc_eval_analysis` run; zip audit 1000 prediction JSON files.
- 2026-06-10：Guide Phase 1 v6 candidate exceeded the current public second-place score. `guide_tpc_env_baseline` now combines official environment-bound generation with official commonsense / hard-logic filtered chronology, budget-transport, route-mode and entity repair. Artifacts: `output/guide/tpc-env-baseline/phase1-v6-route-full/`, zip `XiaoBaGuide_venv6.zip`, eval-analysis `output/guide/eval-analysis/phase1-v6-route-full/`; official score overall 85.0561 / FPR 82.6. Verification：`npm run build`; focused Guide/ToolManager tests; real v4/v5/v6 smoke/full tool runs; real v6 `guide_tpc_eval_analysis` run; zip audit 1000 prediction JSON files.
- 2026-06-10：Guide Phase 1 v3 candidate exceeded the 80-point target. `guide_tpc_env_baseline` now combines official environment-bound generation with official commonsense / hard-logic filtered entity repair. Artifacts: `output/guide/tpc-env-baseline/phase1-env-bound-v3-tool/`, zip `XiaoBaGuide_venv3.zip`, eval-analysis `output/guide/eval-analysis/phase1-v3-repair-tool/`; official score overall 80.1696 / FPR 73.1. Verification：`npm run build`; real 100-task tool smoke; real full tool run; real v3 `guide_tpc_eval_analysis` run.
- 2026-06-09：Guide role evidence expanded with `guide_tpc_eval_analysis` runtime tool and official eval stage analysis. Artifacts under `output/guide/eval-analysis/phase1-schema-baseline-v1-tool/` show schema 1000/1000, commonsense/environment 0/1000, raw hard logic 462/1000, and C-LPR/FPR 0 because no uid reaches `commonsense_pass_id` / `all_pass_id`; Guide docs now require data profile plus eval-analysis evidence before new repair tools. Verification：Guide focused tests, build, real eval-analysis tool run and `npm run check:eval-assets` (4779/4779) passed.
- 2026-06-09：Root plan slimmed to the current two-layer eval + observability evidence architecture; old historical gate logs were removed from this current plan to keep the repo-level source of truth small and navigable.
- 2026-06-09：Default eval gate verified after source cleanup：`npm run check:eval-assets` passed 4775/4775 checks; `npm run build` passed.
- 2026-06-09：Earlier two-layer gate verification in this cleanup pass：`npm run eval:gate` passed 20/20 items and 122/122 cases; `npm run test:contract-smoke` passed 10/10 items and 34/34 cases; `npm run eval:role-benchmarks` passed 10/10 items and 88/88 cases.
- 2026-06-09：Targeted eval/dashboard/reviewer tests in this cleanup pass passed：`node --test -r tsx test/eval-runner.test.ts` passed 59/59; `node --test -r tsx test/eval-benchmark-bridge.test.ts test/eval-gate.test.ts test/eval-schema-validation.test.ts test/dashboard-observability-api.test.ts test/reviewer-eval-profile.test.ts` passed 79/79.

## Risks / Open Questions

- Existing code still has security and evidence gaps; this plan documents them but does not claim they are fixed.
- Some modules have aspirational target architecture that is not implemented yet; plans must keep those gaps visible.
- Memory extraction must stay conservative: only stable user preferences, habits, default behavior and explicit remember-style facts should enter long-term MD memory.
- No GitHub workflow currently enforces the spec/plan gate or quality checks, so drift remains possible without local verification and reviewer discipline.

## Status Maintenance Rules

- Update this file whenever `docs/SPEC.md` adds, removes, or changes a top-level module, contract, or boundary.
- Update this file when `eval/` changes live agent eval boundary、release gate policy or benchmark source boundaries.
- Module owners update their own `PLAN.md` when module `SPEC.md` changes.
- Do not use a single root Mermaid diagram to hide module-level complexity; docs diagrams should remain module-name maps, and module specs should carry the details.
- Do not mark release readiness from README claims alone; use verification evidence from tests, benchmarks, logs, or explicit blocked reasons.
