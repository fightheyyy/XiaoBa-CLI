# BioBench Dataset Card

Source: sessions.zip
Scanned at: 2026-05-19T09:36:36.358Z
Privacy level: redacted

## Scale

- sessions: 17
- episodes: 196
- turns: 519
- runtime events: 9018
- tool calls: 3359
- successful tool calls: 2496
- failed tool calls: 863
- tool success rate: 74.31%
- tokens: 26414149 (25228233+1185916)

## Episode Shape

- turns per episode: avg 2.65, p50 2, p90 5
- tool calls per episode: avg 17.14, p50 8, p90 47
- tokens per episode: avg 134766.07, p50 81948, p90 376075, max 944776

## Task Types

- plot_generation: 127
- cluster_annotation: 34
- r_script_editing: 22
- dialog_task: 7
- remote_workspace_navigation: 2
- workflow_packaging: 2
- artifact_delivery: 1
- report_generation: 1

## Case Categories

- hybrid_case: 161
- skill_case: 25
- runtime_case: 10

## Skill Triggers

- ssh-connect: 32
- scrna-cell-annotation: 7
- remember: 6
- agent-browser: 3
- gene-analysis: 3
- memory-search: 2
- skill-publish: 2
- advanced-reader-2: 1
- ggplot-color-palette: 1
- rstudio-r: 1
- self-evolution: 1

## Failure Modes

- credential_exposure: 144
- timeout: 134
- tool_failure: 126
- context_pressure: 68
- runtime_warning: 37
- runtime_error: 35
- platform_command_mismatch: 33
- restore_event: 18
- compaction_event: 11
- rate_limited_retry: 11
- api_or_network_failure: 6
