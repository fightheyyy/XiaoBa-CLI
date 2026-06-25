# BaseRuntime Live Agent Eval PLAN

状态：Active
最后更新：2026-06-23

## Current Status

BaseRuntime benchmark 已收窄为 11 条 live agent eval。

保留：

- `benchmark.json`
- `runtime-benchmark.jsonl`
- `suites/base-runtime-pet-work-loop.json`
- `suites/trace-derived-runtime-cases.json`

删除：

- 100 条 real trace structural replay cases。
- `suites/high-value-runtime-candidates.json`。
- 所有旧 historical/high-value 中间资产。

## Case Inventory

- `base-runtime.im-coding-patch`
- `base-runtime.im-subagent-goal`
- `base-runtime.pet-work-loop`
- `base-runtime.delivery-no-fallback`
- `base-runtime.malformed-tool-recovery`
- `base-runtime.dangerous-command-boundary`
- `base-runtime.trace-derived.artifact-locator`
- `base-runtime.trace-derived.command-recovery`
- `base-runtime.trace-derived.path-env-recovery`
- `base-runtime.trace-derived.user-correction-latest-artifact`
- `base-runtime.trace-derived.long-work-status`

## Acceptance Criteria

- `runtime-benchmark.jsonl` exactly has 11 rows。
- Every row has `benchmark_case_kind=live_pet_runtime_case`。
- Every referenced suite case has `replay.mode=surface_runtime`。
- `npm run eval:base-runtime` passes 11/11。
- `npm run eval:gate` only runs this live benchmark。

## Verification Log

- 2026-06-25：BaseRuntime Pet suite session keys now follow the maintained Pet role-session contract (`pet:alpha-puff:role-base:<case>`), and benchmark preflight rejects invalid Pet payloads before release eval. Verification：`npm run check:benchmarks`（1 manifest，11 cases）；`npm run eval:base-runtime`（11/11 benchmark cases，11/11 eval cases）；`npm run eval:gate`（1/1 items，11/11 cases）；`node --test -r tsx test/eval-benchmark-bridge.test.ts`（3/3）。

- 2026-06-23：BaseRuntime 从 111-case mixed benchmark 收窄为 11-case live agent eval；删除 100 条 structural trace regression 和 high-value replay suite。Verification：`npm run eval:base-runtime`（11/11 benchmark cases，11/11 eval cases）；`npm run eval:gate`（1/1 items，11/11 cases）；`npm run check:benchmarks`（1 manifest，11 cases）；`npm test`（364 passed，6 skipped）。
