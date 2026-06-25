---
name: daily-brief
description: Build a concise personal daily brief from Feishu agenda and confirmed local context.
toolsets:
  - brief
---

# Daily Brief

Use this skill when the user asks for today's plan, tomorrow's plan, or a daily brief.

Workflow:

1. Determine the requested date and local timezone.
2. Query calendar with `feishu_calendar_agenda` for the relevant day or time window.
3. Use `feishu_task_list`, `feishu_mail_triage`, and `feishu_minutes_search` only when they add relevant, tool-backed brief context.
4. If user auth is missing or expired, start the Feishu auth flow. Use `send_text` when it is visible on channel-delivered surfaces; on CLI, return the URL/code/auth request id directly. After the user completes browser authorization, complete the pending auth flow before retrying the brief.
5. Summarize only tool-backed facts.
6. Keep the brief short: schedule, conflicts, preparation notes, and open questions.

Execution discipline:

- When a needed brief source tool is visible and required inputs are clear, call the tool. Do not narrate or simulate tool calls.

Do not invent task, note, document, or message state.
