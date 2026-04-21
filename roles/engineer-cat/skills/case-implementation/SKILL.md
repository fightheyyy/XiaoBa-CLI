---
name: case-implementation
description: 根据 Inspector/AutoDev 的 assessment 与 handoff，完成 runtime 修复、skill 修复或 skill 新建，并产出结构化交接文件。
version: 1.0.0
author: EngineerCat Team
user_invocable: true
invocable: both
argument-hint: "<AutoDev case 路径或 assessment 路径>"
max-turns: 40
---

# Case Implementation

这个 skill 用来处理 `EngineerCat` 接到的 AutoDev / Inspector 案件。

## 触发条件

- “根据 inspector 报告实现修复”
- “处理这个 AutoDev case”
- “把这个问题做成 skill”
- “修这个已有 skill”

## 硬规则

1. 必须先读 assessment / handoff / case detail，再动手
2. 必须把结果落盘成 `implementation.md` 和 `engineer-output.json`
3. 有实际变更时，优先产出 `implementation.patch`
4. `new_skill_candidate` 必须优先考虑调用 `self-evolution`
5. 不能 self-close，只能交给 `reviewing` 或 `blocked`

## 分类执行

### 1. `runtime_bug`

- 读 evidence
- 做最小修复
- 必要时补最小测试
- 生成实现说明和 patch

### 2. `skill_fix`

- 找到已有 skill
- 修触发、步骤、边界或说明
- 记录改了哪些 skill 文件

### 3. `new_skill_candidate`

- 先确认模式稳定
- 调用 `self-evolution`
- 把生成的新 skill 路径写进 `changedFiles`

## `engineer-output.json` 模板

```json
{
  "version": 1,
  "summary": "一句话总结",
  "overview": "给 Reviewer 的简短说明",
  "resultType": "runtime_fix",
  "riskLevel": "low",
  "nextState": "reviewing",
  "recommendedNextAction": "review_engineer_output",
  "changedFiles": [
    "src/example.ts"
  ],
  "artifacts": []
}
```

## 收尾

- 检查 `implementation.md` 是否能让 Reviewer 读懂
- 检查 `engineer-output.json` 是否是合法 JSON
- 有变更时尽量产出 `implementation.patch`

