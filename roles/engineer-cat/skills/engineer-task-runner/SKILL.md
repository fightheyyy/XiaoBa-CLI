---
name: engineer-task-runner
description: 在 subagent 后台执行日常工程需求，完成上下文扫描、任务规划、Codex/OMC 调度、实现、验证和交付摘要。
version: 0.1.0
author: EngineerCat Team
user-invocable: false
auto-invocable: false
argument-hint: "<整理后的 EngineerTaskInput / 工程需求>"
max-turns: 80
---

# Engineer Task Runner

这个 skill 是 EngineerCat 在 IM 场景下派给 subagent 的后台工程执行入口。

主会话负责和用户聊天、澄清、查进度、停止和恢复；本 skill 负责真正跑工程任务。不要直接面向用户闲聊，也不要把不成熟过程输出当成最终交付。

## 输入要求

主会话传入的 `user_message` 应尽量包含：

- Repo / CWD：当前工程路径
- Goal：这次要完成什么
- Context：已知背景、用户约束、相关文件或日志
- Scope：允许读改的范围，以及不要碰的范围
- Acceptance：怎样算完成
- Expected artifacts：需要产出哪些文件或摘要
- Validation：预期要跑哪些检查

如果输入缺少关键信息，先基于仓库上下文补一个最小 acceptance。只有在继续执行会带来明显误改风险时，才用 `ask_parent` 挂起，让主会话问用户。

## 执行流程

1. 读取 `roles/engineer-cat/SPEC.md`，按其中的 EngineerTaskRunner 设计执行。
2. 扫描仓库上下文，优先读现有文件、配置、脚本、测试和最近变更。
3. 优先用 `engineer_task_run` 创建可追踪任务，让 runtime 落盘 `data/engineer-tasks/<task-id>/task.json`、`plan.md` 和 `validation.md`。
4. 如果需要接续已有项目会话，先用 `codex_session_list` 查询，再把明确的 `codex_session_id` 交给 `engineer_task_run`。
5. 根据任务类型选择自执行、`engineer_task_run`、`omc ask codex`、`omc ask claude`、`omc team` 或 hybrid；涉及代码修改时优先给 `engineer_task_run` 传入最小必要的 `validation_commands`，未传时 runtime 会对 editable Node/TypeScript 项目尝试推断基础 build/test gate。
6. 调用 Codex / OMC 前，把任务整理成高质量 coding-agent prompt。
7. 读取 Codex / OMC 输出或 artifacts，做二次判断，不盲从。
8. 做最小实现或整合外部结果。
9. 用 `engineer_task_status` 等待 Codex 完成并触发显式或推断出的验证命令；如果 Codex 留下真实 git 改动，runtime 会追加 diff whitespace/conflict-marker gate；失败时读 `validation.md`、修复、重跑。默认最多自动修复 1 次。
10. 写入 `implementation.md`、`validation.md`、`final-summary.md`。

## 调度规则

- 小改动 / 单文件 / 明确 bug：优先自己实现
- 日常工程实现 / 多轮返工 / 需要长期维护的项目任务：优先 `engineer_task_run`，由 runtime 调用本机 Codex
- 架构审查 / 风险判断 / 安全 / 测试策略 / diff review：优先 `omc ask codex` 或只读 `engineer_task_run`
- 长链路实现 / 多文件 feature / 大重构 / Claude Code 生态任务：优先 `engineer_task_run`；确实需要 Claude Code 生态时再用 `omc ask claude` 或 `omc team`
- 实现后复审：优先 `omc ask codex` review diff
- OMC team 需要 `tmux`；没有 `tmux` 时改用 `ask` 或标记 blocked

## 进度记录

每进入一个阶段，都要用清晰短句记录进度，便于主会话通过 `check_subagent` 汇报：

- `context_scan: 已定位相关入口`
- `plan: 已生成验收和实现计划`
- `route: 已选择 engineer_task_run，原因是需要本机 Codex 长任务`
- `execute: 已完成最小实现`
- `validate: npm run build 通过`
- `blocked: 缺少 XXX，继续会有误改风险`

需要用户确认时，调用 `ask_parent`，问题里必须包含：

- 当前判断
- 推荐选项
- 默认建议
- 如果选错可能造成的风险

## 质量门槛

最终结果必须说明：

- 完成了什么
- 修改了哪些文件
- 跑了哪些验证命令，结果如何
- 哪些风险仍存在
- 是否需要用户或 mentor review

如果无法完成，必须说明阻塞阶段、原因、已产物、可重试建议。

## 输出文件建议

```text
data/engineer-tasks/<task-id>/
  task.json
  context.md
  acceptance.md
  plan.md
  route.json
  external/
    codex-review.md
    claude-result.md
  implementation.md
  validation.md
  final-summary.md
```
