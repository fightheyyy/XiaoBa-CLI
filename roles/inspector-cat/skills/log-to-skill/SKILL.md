---
name: log-to-skill
description: 从日志提取重复模式，生成新 Skill
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
5. 生成 SKILL.md
6. 询问是否保存
7. 使用 skill-publish 发布
