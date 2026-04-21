---
name: latex-compile-doctor
description: 编译论文并诊断 LaTeX / Overleaf / 导出链路中的问题
version: 1.0.0
author: SciPaperDoctor Team
user_invocable: true
invocable: both
argument-hint: "<稿件路径或项目目录>"
max-turns: 25
---

# LaTeX Compile Doctor

编译论文、定位编译失败原因，并给出最短修复路径。

## 触发条件

- "编译这篇论文"
- "看看为什么 LaTeX 过不了"
- "诊断 Overleaf / pdflatex 问题"
- "帮我把 PDF 导出来"

## 硬规则

1. 必须先读取错误输出，再判断原因
2. 优先修局部编译错误，不要一上来大改整篇稿件
3. 如果本地编译环境不完整，要明确说明缺的是什么
4. 如果需要远端服务或浏览器 fallback，要先说明为什么本地不行

## 工作流程

1. 确认稿件入口文件
2. 执行最小可行编译命令
3. 收集错误输出和日志
4. 判断问题属于：
   - 缺包
   - 路径
   - 编码
   - 图表资源
   - Bib / 引用
   - 编译脚本本身
5. 给出修复建议或直接修局部问题

## 输出要求

- 当前是否可编译
- 根因是什么
- 最短修复路径
- 是否需要 fallback 到其他编译方式

## 注意事项

- 避免反复盲编译
- 如果问题在编译脚本而不是 LaTeX 本身，要明确区分
- 生成 PDF 后要检查产物是否真的存在
