---
name: case-review
description: 根据 case artifact 的 assessment 与 implementation 结果，驱动 Codex job 返工或实现，最终判断是否关单，并补齐 artifact 回写策略与指标。
version: 1.0.0
author: ReviewerCat Team
user_invocable: true
invocable: both
argument-hint: "<case 路径或 review 目录>"
max-turns: 40
---

# Case Review

这个 skill 用来处理 `ReviewerCat` 接到的 case review artifact。ReviewerCat 现在是真人端测 Owner：它不只是被动验收，也可以持续调用 Codex job 工具，把工程任务交给 Codex CLI，并根据真实用户路径继续追问、返工、验收。

## 触发条件

- “验收这个 case artifact”
- “判断要不要关单”
- “这个修复到底算不算完成”
- “补回写策略和指标”
- “让 codex/claude code 继续修这个 case”
- “和 codex cli 多轮交互，把这个问题修到能关单”

## 硬规则

1. 必须先读 assessment 和 implementation artifacts
2. 必须落盘 `review.md` 和 `reviewer-output.json`
3. 只有验证通过时才能 `closed`
4. `closed` 时应补齐 writeback 和 metrics
5. 主要实现和返工应交给 `codex_job_start` / `codex_job_resume`，ReviewerCat 自己保持验收视角
6. 不能把 coding agent 的自评当作通过依据，必须看真实入口行为、trace、日志或 artifacts
7. 单元测试、集成测试、红绿测试和常规 CI 属于 EngineerCat / 工程流水线；ReviewerCat 只读取这些结果作为辅助证据
8. 验收 agent harness 时必须检查 Durable Session、Working Trace、Provider Transcript 三层证据
9. 评测 XiaoBa-CLI roles 时必须按 role effectiveness rubric 记录 scorecard 或 blocked reason
10. 面向人阅读的 Markdown 报告默认中文输出；`reviewer-output.json` / `scorecard.json` 的 key 和状态枚举保持机器可读 contract

## Coding Agent 交互流程

1. 选择稳定 `job_id` 前缀，建议 `case-<caseId>-round-1`
2. 第一轮调用 `codex_job_start`，说明 case 摘要、验收标准、仓库根目录、关键 artifact 路径
3. 用 `codex_job_status` 读取状态；运行中时传 `wait_ms=30000`、`poll_interval_ms=5000` 做 compact 间隔等待，只看是否 still running 和最新 output
4. Codex completed 后读取实现、验证摘要和 artifacts，再按 Review Eval Plan 运行真人端测
5. 如果低层测试结果缺失或失败，把它作为端测前置风险反馈给 Codex / EngineerCat；不要自己接管低层测试实现
6. 如果真人端测不满足验收标准，继续调用 `codex_job_resume`，只传用户路径、失败证据和具体返工要求
7. 对 agent runtime 改动，确认三层状态证据是否足够；缺失时记录 missing evidence、blocked reason 或 reopened reason
8. 对 XiaoBa-CLI role 有效性验收，使用 `reviewer_xiaoba_cli_e2e` 生成 per-role trace、three-layer evidence、role effectiveness scorecard 和 report
9. 直到可以写出明确的 `closed` 或 `reopened`
10. 不要无间隔刷状态；同一轮最多做 3 次带等待的 status，仍未完成就把 `job_id` 和当前状态告诉用户
11. 不要因为 Codex 正在运行就取消并改由 ReviewerCat 自己实现，除非用户明确要求停止或 Codex 已失败/超时/无进展
12. 轮询时不要传 `verbose=true`；只有 completed/failed 后需要查 JSONL 事件细节时才开启
13. GUI / Dashboard / Pet / IM / CLI 项目优先通过真实入口或短时 E2E harness 模拟真人使用
14. `reviewer_module_test` 仅作为历史/辅助证据入口保留，不是默认验收步骤

## 输出模板

```json
{
  "version": 1,
  "summary": "一句话总结",
  "overview": "给平台的结论摘要",
  "decision": "closed",
  "decisionReason": "为什么关单",
  "nextState": "closed",
  "regressionStatus": "passed",
  "riskLevel": "low"
}
```

如果触发过 coding agent，建议额外写入：

```json
{
  "codingAgent": {
    "agent": "codex",
    "sessionId": "Codex 官方 session id",
    "jobIds": ["case-xxx-round-1", "case-xxx-round-2"],
    "turns": 2,
    "status": "implemented | blocked | needs_human"
  }
}
```

如果触发过 XiaoBa-CLI role effectiveness 验收，建议额外写入：

```json
{
  "roleEffectiveness": {
    "targets": ["engineer-cat", "reviewer-cat"],
    "scorecards": ["data/reviewer-runs/<run-id>/scorecard.json"],
    "missingEvidence": [],
    "threeLayerIssues": []
  }
}
```

## 收尾

- 检查 `reviewer-output.json` 是否是合法 JSON
- `closed` 时确认 writeback plan 是否合理
- `reopened` 时确认 reason 是否足够指导返工
- 如果 coding agent 无法完成，记录 job 文件路径，方便人类接手
