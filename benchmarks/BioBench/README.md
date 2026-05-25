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
- episodes: 196
- turns: 519, runtime events: 9018
- turns/episode: avg 2.65, p50 2, p90 5
- tool calls/episode: avg 17.14, p50 8, p90 47
- tokens/episode: avg 134766.07, p50 81948, p90 376075, max 944776
- tokens: 31430188 (30010868+1419320)
- tool calls: 3915, failures: 945, success rate: 75.86%
- generated cases: 24
- case categories: hybrid_case=161, skill_case=25, runtime_case=10
- redaction hits: 4569

## Case Kinds

- artifact_delivery
- cluster_annotation
- context_pressure
- dialog_task
- large_context_task
- log_hygiene_redaction
- plot_generation
- r_script_editing
- remote_workspace_navigation
- runtime_restore

## Top Issues

- credential_exposure: 1355
- runtime_warning: 839
- timeout: 259
- runtime_error: 218
- tool_failure: 206
- context_pressure: 100
- platform_command_mismatch: 40
- restore_event: 39

## Files

- `benchmark.json`: full normalized benchmark manifest.
- `episodes.jsonl`: one extracted episode per line.
- `cases.jsonl`: one generated benchmark case per line.
- `dataset-card.md`: episode-level dataset statistics.
- `summary.md`: generated aggregate summary for quick reading.
- `SPEC.md`: BioBench case construction and trace schema spec.
- `EVALUATION.md`: BioBench industrial evaluation design, branch lanes, A/B scoring, verifier plan.

Implementation plan is maintained in `../PLAN.md`.

## Notes

- Source file paths inside generated artifacts are anonymized unless the CLI is run with `--keep-source-paths`.
- `--include-text` was not used for this catalog artifact, so cases do not include user/assistant previews.
