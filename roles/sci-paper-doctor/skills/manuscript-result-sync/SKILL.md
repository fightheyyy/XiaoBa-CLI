---
name: manuscript-result-sync
description: 根据最新实验结果同步论文中的表格、结果段和相关叙述
version: 1.0.0
author: SciPaperDoctor Team
user_invocable: true
invocable: both
argument-hint: "<稿件路径> <结果文件路径>"
max-turns: 30
---

# Manuscript Result Sync

把最新实验结果同步回论文稿件，避免“结果更新了，稿件没跟上”。

## 触发条件

- "把这些结果同步进论文"
- "更新 manuscript"
- "改表格和结果段"
- "把最新实验写进稿子"

## 硬规则

1. 必须先审计结果，再改稿
2. 只能修改有证据支撑的数字和表述
3. 改表格时要同步检查正文和结论段是否也要改
4. 如果改动会影响 claim 强度，要明确提示用户

## 工作流程

1. 读取稿件和结果文件
2. 如果稿件结构、claim 或审稿压力还没理清，先调用 `paper-reading-doctor`
3. 如果当前其实还在搭章节结构和写作顺序，先调用 `paper-outline-doctor`
4. 找出：
   - 表格
   - 结果段
   - 对比 baseline 的叙述
5. 标出需要同步的位置
6. 先给出修改计划
7. 用户确认或证据充分时，再修改文件

## 输出要求

- 变更了哪些表格值
- 变更了哪些段落
- 哪些结论被削弱或增强
- 哪些地方还不能自动改

## 注意事项

- 多版本稿件时先确认目标稿件
- 如果 LaTeX 表格结构复杂，先小范围改数字，不要整块重写
- 如果结果和旧稿件冲突明显，先告知风险再改
