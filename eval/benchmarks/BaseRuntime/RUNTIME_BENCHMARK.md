# BaseRuntime Live Agent Eval

Generated: 2026-06-23

This benchmark contains only live agent eval cases.

## Source

The 11 cases are Pet/IM runtime replay cases:

- 6 hand-authored BaseRuntime cases。
- 5 real-trace-inspired archetypes rewritten as synthetic live replay cases。

The original historical trace rows are not stored here. A real trace can inspire a case, but the accepted eval case must be rewritten as:

```text
input + setup + replay + expected_tool_use + expected_result + verifier
```

## Files

- `benchmark.json`: manifest and decision policy.
- `runtime-benchmark.jsonl`: 11 live benchmark case rows.
- `suites/base-runtime-pet-work-loop.json`: 6 live Pet/runtime cases.
- `suites/trace-derived-runtime-cases.json`: 5 trace-inspired live Pet/runtime archetypes.

## Counts

- Total benchmark cases: 11.
- Total nested eval cases: 11.
- Structural trace regression cases: 0.

## Run

```bash
npm run eval:base-runtime
```

Expected current result: 11/11 eval cases pass.
