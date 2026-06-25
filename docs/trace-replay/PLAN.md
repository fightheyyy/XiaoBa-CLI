# Trace Replay PLAN

状态：Active
最后更新：2026-06-25
Owner：Runtime / Evaluation maintainers

## Current Status

Trace Replay 已成为 XiaoBa 评测体系里的第一条正式主线，和 Live Agent Eval 分开：

- Replay：历史真实输入 -> 当前 runtime 复跑 -> fresh trace 对比。
- Live Agent Eval：curated benchmark case -> verifier -> scorecard。

当前实现目标是 Pet/Chat trace replay 的最小闭环，不做厚重 diff，也不做 benchmark admission。

## Milestones

1. M0：定义 Replay / Live Agent Eval 双边界：completed。
2. M1：新增 trace replay runner：completed。
3. M2：新增 `xiaoba replay --trace` 和 `npm run replay:trace` 入口：completed。
4. M3：输出 manifest / extracted inputs / replay results / comparison / report：completed。
5. M4：支持 workspace snapshot / restore：not started。
6. M5：支持跨 surface replay（Feishu / Weixin / Pet）：not started。

## Next Steps

- 用近期真实 Pet trace 跑 replay，观察轻任务过重、`/history` 分叉、remember skill 延迟等问题是否可复现。
- 如果 replay 发现稳定退化，再人工整理成 Live Agent Eval benchmark case。
- 后续如需更强复现，再加 workspace snapshot；不要一开始做成厚重 replay bundle。

## Acceptance Criteria

- 给定 `logs/sessions/**/traces.jsonl`，runner 能抽取 `user.text` 并按顺序重放。
- Replay 使用新的 session key，不覆盖旧 session。
- Replay 产出 fresh trace 路径和 visible history 路径。
- Replay summary 能标出 old/new trace count、tool counts、delivery count、final visible count 和失败工具。
- Replay 入口不使用 `eval:*` 命名。
- `eval/` 仍只保留 Live Agent Eval benchmark。

## Verification Log

- 2026-06-25：Trace Replay generated Pet session keys now use the role-scoped `pet:<petId>:role-base:<safe-run-id>` form, matching the current Pet channel session contract while preserving replay isolation. Verification：`node --test -r tsx test/trace-replay-runner.test.ts test/eval-benchmark-bridge.test.ts`（3/3）；`npm test`（353/353）；`npm run build`。
- 2026-06-23：新增 Trace Replay 文档、runner、CLI/script 入口和 focused tests。Verification：`node --test -r tsx test/trace-replay-runner.test.ts`；`npm run build`；`npm run check:benchmarks`；`npm run replay:trace -- --help`；`node dist/index.js replay --help`；真实 Pet trace one-turn smoke 产出 `output/replay/manual-smoke-userboundary20-one-final`、fresh trace 和 visible history。

## Risks / Open Questions

- 当前 replay 不恢复历史 workspace snapshot，所以文件状态可能和原 run 不完全一致。
- 当前 replay 不包含未进入 `traces.jsonl` 的 slash command，例如 `/history`；如需完整用户表面复跑，后续应支持 visible history 输入。
- Replay 使用当前 provider，会受模型随机性、延迟和环境配置影响。
