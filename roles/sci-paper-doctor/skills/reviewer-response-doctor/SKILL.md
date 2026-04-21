---
name: reviewer-response-doctor
description: 将审稿意见拆成修改任务、证据任务和回复策略，形成可执行的大修闭环
version: 1.0.0
author: SciPaperDoctor Team
user_invocable: true
invocable: both
argument-hint: "<审稿意见路径> [稿件路径] [结果路径]"
max-turns: 35
---

# Reviewer Response Doctor

把审稿意见从“长篇批评”拆成一组真正可执行的修改动作。

这个 skill 服务于大修、返修、导师批改后的论文推进。目标不是情绪安抚，而是快速形成修改闭环。

## 触发条件

- "帮我拆审稿意见"
- "这轮大修该怎么改"
- "给我生成回复策略"
- "看 reviewer 主要卡了我哪些点"

## 核心目标

- 识别每条意见到底在打什么
- 区分需要改 wording、补实验、补引用、改结构还是补回复
- 形成一张可执行的 revision board
- 输出面向 reviewer / AE / 导师的回复策略

## 硬规则

1. 先逐条拆意见，不要先进入辩解模式
2. 每条意见都要落到行动类型，不允许只给空泛回复
3. 如果某条意见需要新证据，必须明确移交给相关 skill
4. 不要把“可以解释”误当成“可以不改”
5. 如果多条意见指向同一个根因，要合并成一个主任务

## 行动类型

每条意见至少归为以下之一：

- `wording_fix`
- `structure_fix`
- `result_audit`
- `new_experiment`
- `related_work_update`
- `figure_table_update`
- `response_only`

## 工作流程

1. 读取审稿意见、回复信草稿和当前稿件
2. 逐条拆出 reviewer concerns
3. 给每条 concern 标记：
   - 严重性
   - 行动类型
   - 需要的证据
   - 负责人 / 对应 skill
4. 合并相同根因的任务
5. 输出：
   - revision board
   - 回复策略
   - 高风险项

## 输出格式

尽量按这个结构输出：

```markdown
# 审稿回复诊断

## 总体判断
- 最严重的问题：
- 最容易修的部分：
- 可能需要补实验的部分：

## Revision Board
### 1. {reviewer concern}
- 严重性：
- 行动类型：
- 需要证据：
- 建议动作：
- 移交：

## 回复策略
- 应直接承认并修改的点：
- 需要解释但也要小改的点：
- 需要新实验支撑的点：

## 风险项
- 时间风险：
- 证据风险：
- wording 风险：
```

## 与其他技能的关系

- 需要先读懂稿件和 claim 结构时，先走 `paper-reading-doctor`
- 需要判断 reviewer 质疑是否被结果支持时，交给 `experiment-result-auditor`
- 需要把修改真正落进稿件时，交给 `manuscript-result-sync`
- 需要补实验或追踪新结果时，交给 `experiment-runner-doctor`

## 注意事项

- 这不是“代写回复信”单点技能，而是修改闭环技能
- 真正重要的是把每条意见转成动作和证据要求
- 如果 reviewer 质疑的是叙事或结构，而不是结果本身，要明确区分
