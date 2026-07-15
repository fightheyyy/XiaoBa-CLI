---
name: log-to-skill
description: 从日志诊断重复模式，输出给 EvolutionCat 的候选 Skill handoff
version: 1.0.0
author: InspectorCat Team
user_invocable: true
---

# Log to Skill

## 触发条件

- "提取 skill [路径]"
- "从日志生成 skill"
- "看看能做什么 skill"

## 工作流程

1. 调用 `extract-skill` skill 分析日志
2. 展示识别出的模式列表
3. 询问用户选择哪些模式
4. 优化选中的模式
5. 生成只读的 Candidate Skill 草稿与证据 refs，不创建或保存 `SKILL.md`
6. 输出 `recommended_next_owner: evolution-cat`，由 EvolutionCat 使用 role-local `self-evolution` 生成隔离 candidate
7. InspectorCat 不发布；候选通过 Arena/人工验收并显式晋升后，EvolutionCat 才可按明确请求使用 `skill-publish`
