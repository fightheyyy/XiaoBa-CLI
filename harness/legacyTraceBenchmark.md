# Legacy Trace Benchmark Harness

这个 harness 把旧版 XiaoBa runtime 产出的 `sessions/**/*.jsonl` 离线转换成一个可比较的 benchmark manifest。它不是直接重放私密聊天原文，而是验证旧 trace 是否能被当前 harness 稳定吸收，并把高价值回归场景提炼成 redacted cases。

## Input

- `.zip`：例如微信导出的 `sessions.zip`，内部包含 `sessions/<platform>/<date>/*.jsonl`。
- 目录：已经解压的 `sessions/` 或上级目录。
- 单个 `.jsonl` 文件。

支持两类旧/新混合 schema：

- Legacy turn entry：没有 `entry_type`，但包含 `turn`、`timestamp`、`session_id`、`user`、`assistant`、`tokens`。
- Runtime entry：包含 `entry_type:"runtime"`、`level`、`message`，用于恢复、AI 调用、工具执行等事件。

## Command

```bash
npm run benchmark:legacy-trace -- /path/to/sessions.zip
```

常用参数：

```bash
npm run benchmark:legacy-trace -- /path/to/sessions.zip --out output/legacy-trace-benchmark/manual
npm run benchmark:legacy-trace -- /path/to/sessions.zip --max-cases 24
npm run benchmark:legacy-trace -- /path/to/sessions.zip --include-text
```

默认输出到 `output/legacy-trace-benchmark/<timestamp>/`：

- `benchmark.json`：完整 aggregate、tool stats、file summaries、case manifest。
- `cases.jsonl`：一行一个 benchmark case，便于后续接 replay/eval runner。
- `summary.md`：人工阅读摘要。

`--include-text` 只适合本地私密审阅。默认不写入用户/助手原文；即使开启，也会对 password、secret、token、sshpass `-p`、私网 IP、用户 home 路径做基础脱敏。

## Benchmark Score

分数是 trace-ingestion quality score，不是模型质量分：

- JSONL parse coverage。
- 工具调用成功率。
- 慢工具/超时信号。
- context pressure 信号。
- 日志敏感信息卫生。

这个分数适合用作历史 baseline。当前 runtime 的目标不是逐字复现旧输出，而是让同类 case 在当前 harness 下有更好的可观测性、更少平台错配、更稳的上下文治理，以及更少敏感信息落日志。

## Case Kinds

当前会自动挑选这些类型的高价值回归 case：

- `log_hygiene_redaction`
- `context_pressure`
- `platform_command_mismatch`
- `network_failure_recovery`
- `rate_limit_recovery`
- `slow_tool_observability`
- `artifact_delivery`
- `browser_recovery`
- `multi_tool_task`
- `large_context_task`
- `runtime_restore`

每个 case 包含 baseline 指标和 expectations，后续可以接入更强的 runner，把 expectations 变成真实断言。
