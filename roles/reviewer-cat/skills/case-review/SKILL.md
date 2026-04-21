---
name: case-review
description: 根据 AutoDev case 的 assessment 与 implementation 结果，判断是否关单，并补齐回写策略与指标。
version: 1.0.0
author: ReviewerCat Team
user_invocable: true
invocable: both
argument-hint: "<AutoDev case 路径或 review 目录>"
max-turns: 40
---

# Case Review

这个 skill 用来处理 `ReviewerCat` 接到的 AutoDev review 案件。

## 触发条件

- “验收这个 AutoDev case”
- “判断要不要关单”
- “这个修复到底算不算完成”
- “补回写策略和指标”

## 硬规则

1. 必须先读 assessment 和 implementation artifacts
2. 必须落盘 `review.md` 和 `reviewer-output.json`
3. 只有验证通过时才能 `closed`
4. `closed` 时应补齐 writeback 和 metrics
5. 不能替工程师返工，只能给出 reopen 理由

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

## 收尾

- 检查 `reviewer-output.json` 是否是合法 JSON
- `closed` 时确认 writeback plan 是否合理
- `reopened` 时确认 reason 是否足够指导返工

