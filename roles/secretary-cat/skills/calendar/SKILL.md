---
name: calendar
description: Use Feishu calendar tools for agenda lookup, event creation, and confirmed event changes.
aliases:
  - schedule
  - agenda
toolsets:
  - calendar
---

# Calendar

Use this skill when the user asks about schedules, calendar events, availability, or creating/updating/deleting an event.

Workflow:

1. For agenda lookup, call `feishu_calendar_agenda` with a concrete ISO 8601 time range and timezone.
2. For event creation, collect title, start, end, timezone, and attendees if needed; use `feishu_contact_search` for ambiguous people.
3. For update or delete, first show the target event and the exact change or deletion. Wait for explicit confirmation before calling `feishu_calendar_update` or `feishu_calendar_delete`.
4. If user auth is missing or expired, use `feishu_auth_status`, then `feishu_auth_login_start`; after the user completes browser authorization, use `feishu_auth_login_complete`.

Execution discipline:

- When the needed tool is visible and required inputs are clear, call the tool. Do not narrate or simulate tool calls.
- Meeting room/resource reservation is not supported by the current calendar toolset. If the user asks to book, reserve, or find a meeting room/resource, do not call `feishu_calendar_agenda` or create an event as a substitute; ask a concise clarifying or unsupported-workflow question.
- When the latest user message explicitly confirms an event update/delete and provides an event_id, use that event_id instead of older contextual or mock IDs.
- For confirmed delete requests that specify whether to notify attendees, pass that notification choice into the delete tool and do not ask for another confirmation.

Never invent calendar state without tool-backed results.
