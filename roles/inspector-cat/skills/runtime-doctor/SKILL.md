---
name: runtime-doctor
description: 诊断 XiaoBa Runtime 缺陷并生成 EngineerCat 修复交接包，不直接实现修复
version: 2.0.0
author: InspectorCat Team
user_invocable: true
invocable: both
argument-hint: "<问题描述或日志路径>"
max-turns: 20
---

# Runtime Doctor

`runtime-doctor` 是 InspectorCat 的 runtime 缺陷取证与交接 workflow。它保留历史名称，但生产边界已经变更：它不直接修改代码，不替 EngineerCat 实现，不替 ReviewerCat 验收。

## 触发条件

- "诊断 Runtime bug"
- "这个问题是 Runtime 层面的"
- "帮我把这个 runtime 问题整理给 EngineerCat"
- `analyze_log.issueProfiles[]` 中出现 `runtime_bug`、`benchmark_candidate`、`tool_policy_boundary`

## 硬规则

1. 必须先有证据：日志、session JSONL、tool result、artifact 或用户复现路径。
2. 必须先调用 `analyze_log` 或引用已有 `issueProfiles[]`。
3. 只产出诊断、复现建议、测试建议和 handoff，不直接改代码。
4. Runtime 修复交给 EngineerCat；最终验证交给 ReviewerCat。
5. 样本不足时输出 `insufficient_signal`，不要编造根因。

## 执行流程

1. 确认输入证据和样本质量。
2. 用 `analyze_log` 提取 `summary`、`issues`、`issueProfiles` 和 `toolStats`。
3. 选择最高价值 issue profile，确认：
   - category
   - suspected owner
   - confidence
   - route target
   - recommended next action
4. 写出最小复现方向：
   - 触发条件
   - 相关 session / turn / tool call
   - expected vs actual
   - 需要保留的 artifact
5. 写出 EngineerCat handoff：
   - title
   - category
   - priority
   - rootCauseHypothesis
   - evidence signals
   - suggested files / modules to inspect
   - suggested validation commands
6. 写出 ReviewerCat verification hint：
   - 修复后应该跑什么真实入口或 replay
   - 哪些证据不足以 close

## 输出模板

```markdown
# Runtime Doctor Handoff

## Sample Quality
- signal quality:
- missing evidence:

## Issue Profile
- issue id:
- category:
- severity:
- confidence:
- suspected owner:
- route:
- recommended next action:

## Evidence
- source:
- session / turn / tool:
- observed:
- expected:

## EngineerCat Handoff
- title:
- priority:
- root cause hypothesis:
- files / modules to inspect:
- suggested fix boundary:
- validation plan:

## ReviewerCat Verification Hint
- required E2E / replay evidence:
- cannot close with:

## Skill / Benchmark Opportunity
- skill opportunity:
- benchmark candidate:
```

## `inspector-handoff.json` 建议字段

```json
{
  "version": 1,
  "shouldCreateCase": true,
  "title": "runtime issue title",
  "category": "runtime_bug | insufficient_signal | tool_policy_boundary | external_dependency | benchmark_candidate | role_prompt_issue",
  "priority": "normal",
  "routeToRole": "engineer-cat | reviewer-cat | researcher-cat | inspector-cat | benchmark-maintainer",
  "recommendedNextAction": "runtime_fix | collect_more_signal | review_boundary | create_replay_case | benchmark_case",
  "summary": "short summary",
  "nextState": "fixing",
  "evidenceSummary": {
    "rootCauseHypothesis": "hypothesis",
    "confidence": "medium",
    "signals": ["signal"]
  },
  "labels": ["runtime", "inspector"]
}
```

如果样本不足，设置：

- `shouldCreateCase=false`
- `category=insufficient_signal`
- `recommendedNextAction=collect_more_signal`
- `nextState=blocked`
