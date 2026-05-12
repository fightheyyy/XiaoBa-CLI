# BioBench

## Source

Source: sessions.zip exported from earlier XiaoBa runtime runs. Raw archive is not stored in this repository; generated artifacts are normalized and redacted.

This benchmark stores normalized metrics and redacted case manifests only. It does not store the raw trace archive or raw chat text.

## Theme

Real-world bioinformatics engineering work: remote Linux server operations, R/Seurat object inspection, cluster annotation from marker tables, cell type relabeling, FeaturePlot/DotPlot/DimPlot and heatmap generation, R script editing, report/artifact delivery, and packaging repeated analysis flows into reusable skills.

## Baseline

- score: 69/100
- date range: 2026-04-08 to 2026-05-11 (18 days)
- platforms: catscompany=37, weixin=3
- sessions: 17, interactions: 68
- turns: 519, runtime events: 9018
- tokens: 31430188 (30010868+1419320)
- tool calls: 3915, failures: 945, success rate: 75.86%
- generated cases: 24
- redaction hits: 4555

## Case Kinds

- artifact_delivery
- browser_recovery
- context_pressure
- large_context_task
- log_hygiene_redaction
- multi_tool_task
- platform_command_mismatch
- runtime_restore
- runtime_signal

## Top Issues

- credential_exposure: 1350
- runtime_warning: 839
- timeout: 259
- runtime_error: 218
- tool_failure: 206
- context_pressure: 100
- platform_command_mismatch: 40
- restore_event: 39

## Files

- `benchmark.json`: full normalized benchmark manifest.
- `cases.jsonl`: one generated benchmark case per line.
- `summary.md`: generated aggregate summary for quick reading.

## Notes

- Source file paths inside generated artifacts are anonymized unless the CLI is run with `--keep-source-paths`.
- `--include-text` was not used for this catalog artifact, so cases do not include user/assistant previews.
