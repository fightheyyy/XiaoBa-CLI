# Legacy Trace Benchmark

Source: sessions.zip
Scanned at: 2026-05-12T07:50:49.486Z
Benchmark score: 69/100

## Summary

- files: 40
- lines: 9537, parse coverage: 100.00%
- turns: 519, runtime events: 9018
- platforms: catscompany=37, weixin=3
- dates: 2026-04-08 to 2026-05-11 (18 days)
- sessions: 17, interactions: 68
- tokens: 31430188 (30010868+1419320)
- tool calls: 3915, failures: 945, success rate: 75.86%
- redaction hits: 4555

## Top Issues

- credential_exposure: 1350
- runtime_warning: 839
- timeout: 259
- runtime_error: 218
- tool_failure: 206
- context_pressure: 100
- platform_command_mismatch: 40
- restore_event: 39

## Top Tools

- execute_shell: 2690 calls, 878 failures, avg 54903ms
- read_file: 312 calls, 35 failures, avg 1ms
- edit_file: 266 calls, 16 failures, avg 1ms
- grep: 30 calls, 8 failures, avg 294ms
- glob: 118 calls, 5 failures, avg 12ms
- write_file: 391 calls, 1 failures, avg 4ms
- skill: 71 calls, 1 failures, avg 11ms
- send_text: 12 calls, 1 failures, avg 0ms
- send_file: 16 calls, 0 failures, avg 644ms
- check_subagent: 6 calls, 0 failures, avg 0ms

## Benchmark Cases

- legacy-b902e0b13ed354 (browser_recovery)
  source: sessions/catscompany/2026-04-08/trace-0001.jsonl
  baseline: 1 turns, 4 tool calls, 4 failures, issues=timeout, tool_failure
- legacy-95f55dd4da9a49 (context_pressure)
  source: sessions/catscompany/2026-04-08/trace-0001.jsonl
  baseline: 1 turns, 27 tool calls, 16 failures, issues=context_pressure, rate_limited_retry, timeout, tool_failure
- legacy-ac280eec136444 (context_pressure)
  source: sessions/catscompany/2026-04-09/trace-0002.jsonl
  baseline: 1 turns, 48 tool calls, 6 failures, issues=context_pressure, timeout, tool_failure, platform_command_mismatch
- legacy-b326fa695ce985 (context_pressure)
  source: sessions/catscompany/2026-04-09/trace-0002.jsonl
  baseline: 1 turns, 71 tool calls, 18 failures, issues=context_pressure, rate_limited_retry, timeout, tool_failure, platform_command_mismatch
- legacy-18fd71ad80f32d (log_hygiene_redaction)
  source: sessions/catscompany/2026-04-09/trace-0004.jsonl
  baseline: 1 turns, 100 tool calls, 49 failures, issues=context_pressure, timeout, credential_exposure, tool_failure, platform_command_mismatch
- legacy-c8079dba68159e (platform_command_mismatch)
  source: sessions/catscompany/2026-04-09/trace-0005.jsonl
  baseline: 1 turns, 23 tool calls, 4 failures, issues=tool_failure, platform_command_mismatch
- legacy-4d975748a77eac (log_hygiene_redaction)
  source: sessions/catscompany/2026-04-09/trace-0007.jsonl
  baseline: 1 turns, 61 tool calls, 32 failures, issues=context_pressure, timeout, credential_exposure, tool_failure, platform_command_mismatch
- legacy-0c54d60a02d90d (artifact_delivery)
  source: sessions/catscompany/2026-04-09/trace-0007.jsonl
  baseline: 1 turns, 14 tool calls, 6 failures, issues=timeout, tool_failure
- legacy-869b5c77ce6261 (log_hygiene_redaction)
  source: sessions/catscompany/2026-04-11/trace-0001.jsonl
  baseline: 1 turns, 135 tool calls, 23 failures, issues=context_pressure, timeout, credential_exposure, tool_failure
- legacy-0b173317caa34b (large_context_task)
  source: sessions/catscompany/2026-04-16/trace-0002.jsonl
  baseline: 1 turns, 4 tool calls, 1 failures, issues=tool_failure
- legacy-63d1dcea2b60ce (large_context_task)
  source: sessions/catscompany/2026-04-16/trace-0002.jsonl
  baseline: 1 turns, 4 tool calls, 2 failures, issues=timeout, tool_failure
- legacy-4b5bb7a55d7446 (artifact_delivery)
  source: sessions/catscompany/2026-04-22/trace-0001.jsonl
  baseline: 1 turns, 6 tool calls, 1 failures, issues=tool_failure
- legacy-dd3584367982ea (multi_tool_task)
  source: sessions/catscompany/2026-04-23/trace-0001.jsonl
  baseline: 1 turns, 6 tool calls, 1 failures, issues=tool_failure
- legacy-c17fa87f7da5e0 (multi_tool_task)
  source: sessions/catscompany/2026-04-23/trace-0001.jsonl
  baseline: 1 turns, 12 tool calls, 6 failures, issues=tool_failure
- legacy-08a30237307f46 (multi_tool_task)
  source: sessions/catscompany/2026-04-27/trace-0001.jsonl
  baseline: 1 turns, 5 tool calls, 1 failures, issues=tool_failure
- legacy-9e50b426494a42 (runtime_signal)
  source: sessions/catscompany/2026-04-29/trace-0001.jsonl
  baseline: 0 turns, 0 tool calls, 0 failures, issues=credential_exposure
- legacy-b162afea299b25 (runtime_signal)
  source: sessions/catscompany/2026-04-29/trace-0001.jsonl
  baseline: 0 turns, 0 tool calls, 0 failures, issues=runtime_warning, credential_exposure
- legacy-7e4eb4cb2e8d9e (platform_command_mismatch)
  source: sessions/catscompany/2026-04-29/trace-0002.jsonl
  baseline: 1 turns, 19 tool calls, 3 failures, issues=timeout, tool_failure, platform_command_mismatch
- legacy-2b4ab4625a68af (platform_command_mismatch)
  source: sessions/catscompany/2026-04-29/trace-0002.jsonl
  baseline: 1 turns, 34 tool calls, 6 failures, issues=timeout, tool_failure, platform_command_mismatch
- legacy-b15ba49c272e5e (runtime_restore)
  source: sessions/catscompany/2026-04-30/trace-0001.jsonl
  baseline: 0 turns, 0 tool calls, 0 failures, issues=restore_event
- legacy-6690e2a6d8af88 (runtime_restore)
  source: sessions/catscompany/2026-04-30/trace-0001.jsonl
  baseline: 0 turns, 0 tool calls, 0 failures, issues=restore_event
- legacy-7b62a3c555d017 (runtime_signal)
  source: sessions/catscompany/2026-05-07/trace-0001.jsonl
  baseline: 0 turns, 0 tool calls, 0 failures, issues=runtime_warning, credential_exposure
- legacy-4d40e8db6d43a8 (large_context_task)
  source: sessions/catscompany/2026-05-07/trace-0001.jsonl
  baseline: 1 turns, 4 tool calls, 1 failures, issues=tool_failure
- legacy-0a39103215bd73 (runtime_restore)
  source: sessions/catscompany/2026-05-08/trace-0003.jsonl
  baseline: 0 turns, 0 tool calls, 0 failures, issues=restore_event

## Notes

- This is an offline trace-ingestion benchmark. It scores parseability, tool stability signals, context pressure, and log hygiene from existing traces.
- Case previews are omitted unless the CLI is run with --include-text; previews are redacted before writing.
- Raw session ids are hashed in generated benchmark cases.
