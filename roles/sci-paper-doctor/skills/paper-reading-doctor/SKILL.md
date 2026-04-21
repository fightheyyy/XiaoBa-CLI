---
name: paper-reading-doctor
description: 逐章读取论文、审稿意见和图表证据，提炼 claim map、图表要点和可交给结果审计/稿件同步的结构化结论
version: 1.0.0
author: SciPaperDoctor Team
user_invocable: true
invocable: both
argument-hint: "<论文或稿件路径> [结果路径] [审稿意见路径]"
max-turns: 35
---

# Paper Reading Doctor

把论文读懂，再交给后续 doctor 技能处理。

这个 skill 吸收了旧 `paper-analysis` 的核心思路，但不依赖那套重解析流水线。它服务的是 `SciPaperDoctor` 的主链路：

- 先读论文和审稿意见
- 再抽出 claim map、图表证据和风险点
- 然后把结论交给 `experiment-result-auditor` 或 `manuscript-result-sync`

## 触发条件

- "先帮我读懂这篇论文"
- "把这篇稿子拆一下结构"
- "看审稿意见主要打在哪些点"
- "先提取论文里的 claims 和关键图表"

## 适用输入

- 论文稿件：`.tex`、`.md`
- 评审意见、回复信、导师修改要求
- 论文相关的结构化提取结果：`full.md`、章节分析、图表说明
- 结果文件（可选，用于提前建立 claim 和 evidence 的连接）

## 核心目标

- 提取论文主线：问题、方法、实验设置、核心结论
- 建立 claim map：哪些结论需要哪些结果支撑
- 标出关键图表、表格和高风险表述
- 给后续 skill 一个可执行的证据框架

## 硬规则

1. 优先读取可编辑和可定位的文本资产：`.tex`、`.md`、回复信；不要一上来硬啃 PDF
2. 如果工作区里已有 `full.md`、章节分析或图表说明，优先利用这些结构化产物
3. 只有在当前仓库确实存在解析链路时，才通过 `execute_shell` 调用外部解析脚本
4. 不要把“作者写了什么”直接当成“结果已经支持”
5. 每次输出都要明确哪些 claim 仍需要 `experiment-result-auditor` 继续核证

## 推荐工作流

1. 先用 `glob` 找相关资产：
   - `*.tex`
   - `*.md`
   - `review*`
   - `response*`
   - `full.md`
   - `summary.md`
2. 优先读取：
   - 最新 manuscript
   - 审稿意见 / 回复信
   - 论文结构化文本（如果有）
3. 抽取 5 类信息：
   - 研究问题
   - 方法主张
   - 核心实验结论
   - 关键图表 / 表格
   - 高风险表述
4. 形成 claim map：
   - claim 是什么
   - 当前在稿件哪里
   - 需要什么证据支持
   - 目前是否已经有结果文件对应
5. 输出移交建议：
   - 哪些交给 `paper-outline-doctor`
   - 哪些交给 `experiment-result-auditor`
   - 哪些交给 `manuscript-result-sync`
   - 哪些交给 `reviewer-response-doctor`
   - 哪些属于 `latex-compile-doctor`

## PDF 与解析策略

- 如果用户给的是 `.tex` / `.md`，直接读这些文件，不要多此一举转 PDF
- 如果用户只给了 PDF，先检查当前工作区附近是否已有：
  - `full.md`
  - 解析目录
  - 章节分析目录
- 只有在当前项目里能确认存在可用解析脚本时，才调用它
- 如果当前 runtime 里没有稳定的 PDF 解析链路，要明确说明限制，不要假装已经完成精读

## 重点输出

### 1. Paper Map

- 论文在解决什么问题
- 方法到底声称改进了什么
- 实验部分如何组织
- 结论最依赖哪几张表和图

### 2. Claim Map

每个核心 claim 至少写清：

- claim 内容
- 稿件位置
- 需要的证据类型
- 当前风险等级

### 3. Reviewer / Advisor Pressure Map

- 审稿人最在意什么
- 导师要求集中在哪些修改点
- 哪些 claim 需要收缩 wording

## 输出格式

尽量按这个结构输出：

```markdown
# 论文阅读诊断

## 项目材料
- 主稿件：
- 审稿意见：
- 结构化文本：

## Paper Map
- 研究问题：
- 方法主张：
- 实验主线：
- 关键图表：

## Claim Map
### 1. {claim}
- 稿件位置：
- 需要证据：
- 当前状态：ready_for_audit / wording_risky / evidence_missing
- 下一步：

## 审稿与交付风险
- 高风险表述：
- 审稿人敏感点：
- 导师交付点：

## 移交建议
- 给 experiment-result-auditor：
- 给 manuscript-result-sync：
- 给 latex-compile-doctor：
```

## 与其他技能的关系

- 如果当前主要任务是先把论文结构和章节顺序搭出来，交给 `paper-outline-doctor`
- 读懂论文后，结果核证交给 `experiment-result-auditor`
- 需要把已确认结果落回稿件时，交给 `manuscript-result-sync`
- 需要先拆审稿意见和回复策略时，交给 `reviewer-response-doctor`
- 发现主要问题是编译、导出、表格排版时，交给 `latex-compile-doctor`
- 发现主要问题是实验仍未产出、日志不稳、脚本未跑通时，交给 `experiment-runner-doctor`

## 注意事项

- 这不是泛论文总结 skill，而是为论文交付服务的 doctor skill
- 不要花大量篇幅复述背景知识，重点是 claim、证据、风险和后续动作
- 如果只有局部材料，也可以先做局部 claim map，但要明确范围
