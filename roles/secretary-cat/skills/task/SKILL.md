---
name: task
description: Use Feishu task tools for task lookup and confirmed task mutations.
aliases:
  - todo
  - tasks
toolsets:
  - task
---

# Task

Use this skill when the user asks about Feishu tasks, todos, completion state, or task creation.

Workflow:

1. Use `feishu_task_list` for current task state.
2. For create, update, complete, or reopen actions, summarize the target task and exact change first.
3. Only after explicit user confirmation, call the matching confirmed task tool.
4. If the task target is ambiguous, ask a clarifying question instead of guessing.

Execution discipline:

- When the needed tool is visible and required inputs are clear, call the tool. Do not narrate or simulate tool calls.
- When the latest user message explicitly confirms a task create/update/state change and provides the task target or content, call the matching confirmed tool with `confirmed: true`. Do not ask for another confirmation.
