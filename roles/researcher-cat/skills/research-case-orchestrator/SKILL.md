---
name: research-case-orchestrator
description: 将长周期科研任务拆成 project map、evidence board、实验队列、稿件同步和交付闭环
version: 1.0.0
author: ResearcherCat Team
user_invocable: true
invocable: both
argument-hint: "<项目目录或研究目标> [稿件路径] [结果路径] [审稿意见路径]"
max-turns: 40
---

# Research Case Orchestrator

把一个真实科研项目从“材料很乱、目标很大”推进到“下一步能执行、证据能落稿、产物能交付”。

这个 skill 来自 TTT(TimeTeachTransformer) 长周期 IM case。它不是单点论文润色，而是长周期研究推进入口：读项目、拆主线、设计补实验、盯运行、核结果、同步稿件、生成交付件，并把重复流程沉淀回技能。

## 触发条件

- "你来主导这个论文的补实验和修订"
- "这个研究项目你先整体看一下"
- "帮我把这篇论文从实验到交付推进完"
- "现在材料很多，你判断下一步该做什么"
- "跑了很久，帮我接上之前的研究进度"

## 核心目标

- 建立项目地图，而不是只回答当前一句话
- 建立 claim 和 evidence 的对应关系
- 把补实验拆成可运行、可监控、可恢复的队列
- 把已确认结果同步到 manuscript、figure、table、PPT、PDF
- 面向用户已看过的 IM 消息保持连续，不重复承诺、重复发送或改口

## 硬规则

1. 先建立 `Project Map`，再决定是否跑实验或改稿
2. 没有证据时，不把想法写成论文结论
3. 长实验必须有日志、输出路径和恢复策略
4. 每次阶段性推进后，都要更新 `Research Board`
5. 用户可见交付件必须记录路径和版本，避免重复发送旧文件
6. 如果卡点来自 XiaoBa Runtime、context compression、文件发送或工具输出，应明确移交 `InspectorCat`
7. 能沉淀为稳定流程时才建议新 skill，不把一次性探索硬包装成 skill

## Research Board

长周期项目中必须维护这几类状态：

- `project_goal`：用户真正要完成的论文、实验或交付目标
- `current_storyline`：当前论文主线和贡献说法
- `claim_board`：每个 claim 是否有结果支撑
- `experiment_queue`：待跑、运行中、已完成、失败的实验
- `artifact_board`：已交付的 manuscript、figure、PPT、PDF、package
- `risk_board`：证据风险、编译风险、时间风险、runtime 风险
- `next_actions`：下一轮最该做的 1-3 个动作

## 工作流程

1. 读取项目目录、已有稿件、结果文件、审稿意见和最近运行日志
2. 输出 `Project Map`：
   - 研究问题
   - 当前主线
   - 关键材料
   - 已有产物
   - 最大阻塞
3. 建立 `Research Board`
4. 判断当前阶段：
   - 读项目：转 `paper-reader`
   - 搭结构：转 `paper-architect`
   - 核结果：转 `evidence-auditor`
   - 跑实验：转 `experiment-runner`
   - 同步稿件：转 `manuscript-sync`
   - 编译导出：转 `latex-compiler`
   - 大修返修：转 `revision-planner`
5. 每轮完成后输出：
   - 已完成什么
   - 证据在哪里
   - 产物在哪里
   - 下一步做什么

## 输出格式

长分析尽量按这个结构输出：

```markdown
# Research Board

## Project Map
- 目标：
- 主线：
- 关键材料：
- 当前阻塞：

## Evidence / Claim
- 已支持：
- 弱支持：
- 缺证据：

## Experiment Queue
- 已完成：
- 运行中：
- 待补：
- 失败/需诊断：

## Artifact Board
- 稿件：
- 图表：
- PPT/PDF：
- 包/数据：

## Next Actions
1. 
2. 
3. 
```

## 注意事项

- 这是 ResearcherCat 的入口技能，负责判断方向和调度其他技能
- 不要陷入单个 shell 命令，要持续维护研究状态
- 不要只做“论文建议”，要把建议落成实验、稿件或交付动作
- 用户焦虑进度时，优先给清楚的状态、证据和下一步，而不是大段解释
