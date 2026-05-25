# Legacy Trace Benchmark

Source: sessions.zip
Scanned at: 2026-05-19T09:36:36.358Z
Benchmark score: 69/100

## Summary

- files: 40
- lines: 9537, parse coverage: 100.00%
- turns: 519, runtime events: 9018, episodes: 196
- turns/episode: avg 2.65, p50 2, p90 5
- tool calls/episode: avg 17.14, p50 8, p90 47
- tokens/episode: avg 134766.07, p50 81948, p90 376075, max 944776
- platforms: catscompany=37, weixin=3
- dates: 2026-04-08 to 2026-05-11 (18 days)
- sessions: 17, interactions: 68
- tokens: 31430188 (30010868+1419320)
- tool calls: 3915, failures: 945, success rate: 75.86%
- redaction hits: 4569

## Top Issues

- credential_exposure: 1355
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

- biobench.case.000005 (runtime_case/remote_workspace_navigation)
  source: sessions/catscompany/2026-04-08/trace-0003.jsonl
  episode: biobench.ep.000005, task=remote_workspace_navigation, skills=none
  baseline: 2 turns, 6 tool calls, 1 failures, tokens=5675, successRate=83.33%, issues=tool_failure
- biobench.case.000018 (hybrid_case/log_hygiene_redaction)
  source: sessions/catscompany/2026-04-09/trace-0001.jsonl
  episode: biobench.ep.000018, task=plot_generation, skills=none
  baseline: 5 turns, 102 tool calls, 33 failures, tokens=944776, successRate=67.65%, issues=context_pressure, credential_exposure, timeout, tool_failure
- biobench.case.000023 (hybrid_case/context_pressure)
  source: sessions/catscompany/2026-04-09/trace-0002.jsonl
  episode: biobench.ep.000023, task=cluster_annotation, skills=agent-browser
  baseline: 2 turns, 119 tool calls, 24 failures, tokens=541672, successRate=79.83%, issues=context_pressure, platform_command_mismatch, rate_limited_retry, timeout, tool_failure
- biobench.case.000024 (skill_case/plot_generation)
  source: sessions/catscompany/2026-04-09/trace-0003.jsonl
  episode: biobench.ep.000024, task=plot_generation, skills=remember, skill-publish
  baseline: 5 turns, 5 tool calls, 0 failures, tokens=29688, successRate=100.00%, issues=none
- biobench.case.000026 (hybrid_case/log_hygiene_redaction)
  source: sessions/catscompany/2026-04-09/trace-0004.jsonl
  episode: biobench.ep.000026, task=plot_generation, skills=ssh-connect
  baseline: 5 turns, 223 tool calls, 97 failures, tokens=539665, successRate=56.50%, issues=context_pressure, credential_exposure, platform_command_mismatch, timeout, tool_failure
- biobench.case.000027 (hybrid_case/log_hygiene_redaction)
  source: sessions/catscompany/2026-04-09/trace-0005.jsonl
  episode: biobench.ep.000027, task=plot_generation, skills=ssh-connect
  baseline: 12 turns, 80 tool calls, 19 failures, tokens=577883, successRate=76.25%, issues=context_pressure, credential_exposure, platform_command_mismatch, timeout, tool_failure
- biobench.case.000032 (skill_case/r_script_editing)
  source: sessions/catscompany/2026-04-09/trace-0007.jsonl
  episode: biobench.ep.000032, task=r_script_editing, skills=none
  baseline: 1 turns, 1 tool calls, 0 failures, tokens=82714, successRate=100.00%, issues=none
- biobench.case.000046 (hybrid_case/log_hygiene_redaction)
  source: sessions/catscompany/2026-04-11/trace-0001.jsonl
  episode: biobench.ep.000046, task=plot_generation, skills=none
  baseline: 2 turns, 146 tool calls, 27 failures, tokens=681251, successRate=81.51%, issues=context_pressure, credential_exposure, timeout, tool_failure
- biobench.case.000068 (skill_case/r_script_editing)
  source: sessions/catscompany/2026-04-14/trace-0001.jsonl
  episode: biobench.ep.000068, task=r_script_editing, skills=none
  baseline: 2 turns, 2 tool calls, 1 failures, tokens=1827, successRate=50.00%, issues=tool_failure
- biobench.case.000077 (runtime_case/artifact_delivery)
  source: sessions/catscompany/2026-04-14/trace-0002.jsonl
  episode: biobench.ep.000077, task=artifact_delivery, skills=none
  baseline: 1 turns, 1 tool calls, 0 failures, tokens=4004, successRate=100.00%, issues=none
- biobench.case.000091 (runtime_case/dialog_task)
  source: sessions/catscompany/2026-04-15/trace-0002.jsonl
  episode: biobench.ep.000091, task=dialog_task, skills=none
  baseline: 3 turns, 0 tool calls, 0 failures, tokens=25627, successRate=100.00%, issues=none
- biobench.case.000089 (runtime_case/dialog_task)
  source: sessions/catscompany/2026-04-15/trace-0002.jsonl
  episode: biobench.ep.000089, task=dialog_task, skills=none
  baseline: 1 turns, 0 tool calls, 0 failures, tokens=17751, successRate=100.00%, issues=none
- biobench.case.000087 (runtime_case/dialog_task)
  source: sessions/catscompany/2026-04-15/trace-0002.jsonl
  episode: biobench.ep.000087, task=dialog_task, skills=none
  baseline: 1 turns, 0 tool calls, 0 failures, tokens=17738, successRate=100.00%, issues=none
- biobench.case.000109 (runtime_case/large_context_task)
  source: sessions/weixin/2026-04-16/trace-0001.jsonl
  episode: biobench.ep.000109, task=dialog_task, skills=none
  baseline: 1 turns, 0 tool calls, 0 failures, tokens=83793, successRate=100.00%, issues=none
- biobench.case.000115 (skill_case/cluster_annotation)
  source: sessions/catscompany/2026-04-22/trace-0001.jsonl
  episode: biobench.ep.000115, task=cluster_annotation, skills=none
  baseline: 2 turns, 6 tool calls, 1 failures, tokens=75064, successRate=83.33%, issues=tool_failure
- biobench.case.000131 (skill_case/r_script_editing)
  source: sessions/catscompany/2026-04-23/trace-0001.jsonl
  episode: biobench.ep.000131, task=r_script_editing, skills=none
  baseline: 4 turns, 5 tool calls, 0 failures, tokens=8530, successRate=100.00%, issues=none
- biobench.case.000122 (skill_case/plot_generation)
  source: sessions/catscompany/2026-04-23/trace-0001.jsonl
  episode: biobench.ep.000122, task=plot_generation, skills=gene-analysis
  baseline: 2 turns, 7 tool calls, 1 failures, tokens=46672, successRate=85.71%, issues=tool_failure
- biobench.case.000140 (runtime_case/large_context_task)
  source: sessions/catscompany/2026-04-27/trace-0001.jsonl
  episode: biobench.ep.000140, task=dialog_task, skills=none
  baseline: 1 turns, 0 tool calls, 0 failures, tokens=42517, successRate=100.00%, issues=none
- biobench.case.000146 (skill_case/plot_generation)
  source: sessions/catscompany/2026-04-28/trace-0001.jsonl
  episode: biobench.ep.000146, task=plot_generation, skills=none
  baseline: 5 turns, 1 tool calls, 0 failures, tokens=96862, successRate=100.00%, issues=none
- biobench.case.000159 (hybrid_case/context_pressure)
  source: sessions/catscompany/2026-04-29/trace-0002.jsonl
  episode: biobench.ep.000159, task=r_script_editing, skills=none
  baseline: 8 turns, 74 tool calls, 9 failures, tokens=299901, successRate=87.84%, issues=context_pressure, platform_command_mismatch, timeout, tool_failure
- biobench.case.000160 (hybrid_case/context_pressure)
  source: sessions/catscompany/2026-04-29/trace-0002.jsonl
  episode: biobench.ep.000160, task=cluster_annotation, skills=none
  baseline: 3 turns, 48 tool calls, 11 failures, tokens=173366, successRate=77.08%, issues=context_pressure, platform_command_mismatch, timeout, tool_failure
- biobench.case.000161 (hybrid_case/context_pressure)
  source: sessions/catscompany/2026-04-29/trace-0002.jsonl
  episode: biobench.ep.000161, task=r_script_editing, skills=none
  baseline: 5 turns, 56 tool calls, 9 failures, tokens=376075, successRate=83.93%, issues=context_pressure, platform_command_mismatch, timeout, tool_failure
- biobench.case.000177 (skill_case/plot_generation)
  source: sessions/catscompany/2026-05-08/trace-0001.jsonl
  episode: biobench.ep.000177, task=plot_generation, skills=none
  baseline: 5 turns, 6 tool calls, 0 failures, tokens=310252, successRate=100.00%, issues=none
- biobench.case.000196 (runtime_case/runtime_restore)
  source: sessions/catscompany/2026-05-11/trace-0001.jsonl
  episode: biobench.ep.000196, task=dialog_task, skills=none
  baseline: 1 turns, 0 tool calls, 0 failures, tokens=20042, successRate=100.00%, issues=restore_event

## Notes

- This is an offline trace-ingestion benchmark. It scores parseability, tool stability signals, context pressure, and log hygiene from existing traces.
- Case previews are omitted unless the CLI is run with --include-text; previews are redacted before writing.
- Raw session ids are hashed in generated benchmark cases.
