# Live Benchmarks PLAN

状态：Active
最后更新：2026-06-23

## Current Status

`eval/benchmarks/` 只保留 `BaseRuntime` live agent eval benchmark。

Current files:

- `BaseRuntime/benchmark.json`
- `BaseRuntime/runtime-benchmark.jsonl`
- `BaseRuntime/suites/base-runtime-pet-work-loop.json`
- `BaseRuntime/suites/trace-derived-runtime-cases.json`

Accepted suite replay mode is `surface_runtime` only.

Deleted from this folder:

- RoleArena
- EngineerCat
- ResearcherCat
- UserCat
- BaseRuntime high-value structural trace regression suite
- low-level replay suites for `conversation_runner`、`agent_session`、`surface_adapter`

## Next Steps

- 新增 role benchmark 前，先把 case 重写成 `surface_runtime` live agent replay。
- 不恢复 static JSONL fixture benchmark。
- 不恢复 contracts/rubrics/schemas 到 `eval/`。
- 所有 benchmark manifest 必须通过 `check:benchmarks` 的 live-only guard。

## Acceptance Criteria

- `find eval/benchmarks -maxdepth 2 -type d` 只显示 BaseRuntime 作为 benchmark root。
- `npm run check:benchmarks` 只发现 1 个 manifest，并确认 11 个 cases 都是 `surface_runtime` live replay。
- `npm run eval:base-runtime` 通过 11/11。

## Verification Log

- 2026-06-23：Benchmark runner live-only guard tightened to `surface_runtime` only, and the synthetic bridge test now uses Pet surface runtime instead of `conversation_runner`. Verification：`npm run check:benchmarks`（1 manifest，11 cases）；`npm run eval:base-runtime`（11/11 benchmark cases，11/11 eval cases）；`node --test -r tsx test/eval-benchmark-bridge.test.ts`（2/2）；`npm run build`。
- 2026-06-23：Added live-only benchmark guard to `runEvalBenchmark` and `check:benchmarks`; BaseRuntime JSONL rows now include required live metadata, including missing `task_prompt` on trace-derived cases. Verification：`npm run check:benchmarks`（1 manifest，11 live cases）；`npm run eval:base-runtime`（11/11 benchmark cases，11/11 eval cases）；`npm run eval:gate`（1/1 items，11/11 cases）。
- 2026-06-23：收窄 benchmark roots，只保留 BaseRuntime live agent eval。Verification：`npm run eval:base-runtime`（11/11 benchmark cases，11/11 eval cases）；`npm run eval:gate`（1/1 items，11/11 cases）；`npm run check:benchmarks`（1 manifest，11 cases）；`npm test`（364 passed，6 skipped）。
