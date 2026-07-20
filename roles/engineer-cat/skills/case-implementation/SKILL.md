---
name: case-implementation
description: 根据 Inspector handoff 或 case artifact 的 assessment 与 handoff，完成 runtime 修复、skill 修复或 skill 新建，并产出结构化交接文件。
version: 1.0.0
author: EngineerCat Team
user_invocable: true
invocable: both
argument-hint: "<case 路径或 assessment 路径>"
max-turns: 40
---

# Case Implementation

这个 skill 用来处理 `EngineerCat` 接到的 Inspector 案件或 case artifact。

## 触发条件

- “根据 inspector 报告实现修复”
- “处理这个 case artifact”
- “把这个问题做成 skill”
- “修这个已有 skill”

## 硬规则

1. 必须先读 assessment / handoff / case detail，再动手
2. 必须把结果落盘成 `implementation.md` 和 `engineer-output.json`
3. 有实际变更时，优先产出 `implementation.patch`
4. `new_skill_candidate` 必须把实现证据和候选草稿交给 EvolutionCat；EngineerCat 不调用不可见的 `self-evolution`
5. 不能 self-close，只能交给 `reviewing` 或 `blocked`
6. 定时自进化 `repair` 必须只在 runtime 提供的隔离 Git worktree 内修改；不得定位、切换或写入 scheduler checkout
7. `fixed` 必须存在真实代码 diff；runtime 负责从固定 `base_commit` 生成内容寻址 `candidate.patch`，EngineerCat 不得伪造 patch hash
8. 定时自进化中的 `implementation.md`、`engineer-output.json` 与验证产物必须写入 runtime 指定的当次 `output/evolution/sleep/<date>/`，作为证据保存而不是混入源码 patch

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
- 输出 `recommended_next_owner: evolution-cat` 和可直接使用的 candidate handoff
- 如果 EvolutionCat 已回传新 skill，再把路径写进 `changedFiles`

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
