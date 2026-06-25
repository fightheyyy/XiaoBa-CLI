# SecretaryCat PRD

## One-Line Summary

`SecretaryCat` is a local personal secretary role for XiaoBa Runtime. It uses a small local model, narrow Feishu CLI wrapper tools, and strict delivery/confirmation rules to help the user manage calendar, tasks, messages, notes, and daily brief workflows.

## Background

The user wants a local secretary that can operate real productivity systems without sending private context to a remote general-purpose model by default.

Recent local validation showed:

- `gemma4:e4b-mlx` runs locally through Ollama on Apple Silicon.
- Ollama OpenAI-compatible `tools` calls work with XiaoBa-style function schemas.
- `lark-cli` is installed and configured.
- Feishu user identity can be authorized.
- A real calendar event can be created, queried, and deleted through `lark-cli`.
- Gemma4 can complete a multi-turn flow: choose calendar query tool, consume real JSON result, then call `send_text`.

This makes a dedicated Feishu-first secretary role realistic before any SFT.

## Product Goals

- Provide a reliable personal secretary role for day-to-day Feishu and local desktop workflows.
- Keep the model's action space narrow and safe through typed wrapper tools.
- Make all user-visible channel replies go through delivery tools such as `send_text`.
- Support multi-turn tool workflows: query, interpret result, ask for confirmation, then write.
- Capture successful and failed tool trajectories for later LoRA/SFT.

## Non-Goals

- Do not expose raw `execute_shell` to the secretary role.
- Do not let the model generate arbitrary `lark-cli` commands.
- Do not send Feishu messages without explicit confirmation.
- Do not modify or delete existing calendar/task/doc resources without explicit confirmation.
- Do not build the full Mac-native secretary toolset in the first release.
- Do not require SFT for MVP.

## Target Users

- Primary: the owner of this local XiaoBa installation.
- Secondary: future trusted personal workspace users who want a local agent with office-tool access.

## Surfaces

MVP should support:

- CLI: `xiaoba chat --role secretary-cat`
- Pet/Dashboard chat once the role is stable
- Feishu chat entry later, after delivery rules are hardened

## Model Strategy

Default model:

```text
gemma4:e4b-mlx via Ollama
```

Recommended config:

```env
XIAOBA_LLM_PROVIDER=openai
XIAOBA_LLM_API_BASE=http://127.0.0.1:11434/v1
XIAOBA_LLM_API_KEY=ollama
XIAOBA_LLM_MODEL=gemma4:e4b-mlx
```

Rationale:

- Local and user-controlled.
- Fast enough for secretary workflows.
- Supports tool calls.
- Large context is useful for task state and daily summaries.

SFT/LoRA should be deferred until enough real traces exist. The first release should rely on prompt + wrapper design.

## MVP Capability Scope

### Calendar

- Query agenda by time range.
- Create calendar events when the user explicitly asks.
- Delete only events created by SecretaryCat or events explicitly identified by the user.
- Update events only after showing a confirmation summary.

### Auth

- Detect missing Feishu user authorization.
- Start user auth flow and send the verification URL to the user.
- Never pretend calendar data is available when auth is missing.

### Messaging

- Draft Feishu messages.
- Search contacts if needed.
- Send only after explicit user confirmation.

### Expanded Runtime Slice

Implemented first-batch runtime wrappers now cover:

- `task`: list assigned tasks, create/update tasks, complete/reopen tasks.
- `mail`: triage/search summaries, read one message, create drafts, send existing drafts after confirmation.
- `minutes`: search minutes, get metadata, fetch VC notes by minute token, get media download URLs by default.
- `docs`: search/fetch docs with docs v2, create/update docs after confirmation.
- `drive`: search files, upload/import after confirmation, download files with overwrite confirmation.
- `sheets`: read ranges and append rows after confirmation.
- `base`: list tables/fields/records and upsert records after confirmation.

This slice is intentionally narrower than the full target surface. It does not yet include mail reply/forward shortcuts, IM chat/file/group management, calendar busy/free and meeting rooms, drive permission/delete/share flows, sheets overwrite, or Base schema/view/workflow management.

## Target Capability Scope

SecretaryCat should eventually cover the full secretary Feishu surface through narrow wrapper tools:

| Domain | Secretary use | Write policy |
| --- | --- | --- |
| `calendar` | agenda, create/update/delete events, busy/free, attendees, meeting rooms | update/delete require confirmation; create requires clear intent |
| `contact` | resolve names/emails to user ids and show contact details | read-only |
| `im` | draft/send messages, search chats, files, groups, urgent notifications | send and group/file actions require confirmation |
| `task` | create tasks, list/update status, split subtasks, assign owners, attach files | create/update/assign/status changes require confirmation |
| `mail` | draft/send/reply/forward/search emails and attachments | send/reply/forward require confirmation; draft-only creation is allowed |
| `minutes` | fetch meeting summaries, chapters, transcripts, and action items | local media download, upload, rename, and speaker changes require confirmation |
| `docs` | create/read/summarize/edit Feishu docs | create/update require confirmation |
| `drive` | upload/download files, folders, metadata, permissions, comments | upload/import/delete/move/permission/share changes require confirmation; overwrite download requires confirmation |
| `sheets` | read/write spreadsheets, append rows, export sheets | writes require confirmation for existing sheets |
| `base` | structured trackers, fields, records, views, dashboards, workflows | schema/record/workflow changes require confirmation |

Implementation rule: do not expose raw generic `lark-cli` to the model. Add one typed wrapper family per domain, with compact JSON output and secret filtering.

### Delivery

- Use `send_text` for all user-visible output on channel-delivered surfaces.
- Direct model content is not user-visible on channel-delivered surfaces by default; the model must call `send_text` / `send_file`.

### Evidence

- Log each tool decision, tool result, final delivery, and confirmation gate.
- Save enough transcript detail for future SFT data extraction.

## Tool Design

SecretaryCat should receive only secretary-specific wrapper tools. These tools may call `lark-cli` internally, but the model should not see raw shell commands.

### `feishu_auth_status`

Risk: read

Purpose: Check current Feishu auth state.

Parameters:

```json
{
  "type": "object",
  "properties": {},
  "required": []
}
```

Output:

```json
{
  "ok": true,
  "user_identity": "ready",
  "bot_identity": "ready",
  "scopes": ["calendar:calendar.event:read"]
}
```

### `feishu_auth_login_start`

Risk: write/auth

Purpose: Start Feishu user authorization when a personal-resource tool needs missing scopes.

Parameters:

```json
{
  "type": "object",
  "properties": {
    "domain": {
      "type": "string",
      "description": "Comma-separated domains such as calendar,contact,im,task,docs,drive"
    },
    "recommend": {
      "type": "boolean",
      "description": "Use recommended scopes when true"
    }
  },
  "required": ["domain"]
}
```

Output:

```json
{
  "ok": true,
  "verification_uri": "https://...",
  "user_code": "ABCD-EFGH",
  "device_code": "..."
}
```

Model rule: after this tool returns a verification URL, call `send_text` with the URL and code.

### `feishu_calendar_agenda`

Risk: read

Purpose: Query the user's calendar.

Parameters:

```json
{
  "type": "object",
  "properties": {
    "start": {
      "type": "string",
      "description": "ISO 8601 with timezone"
    },
    "end": {
      "type": "string",
      "description": "ISO 8601 with timezone"
    },
    "calendar_id": {
      "type": "string",
      "description": "Defaults to primary"
    }
  },
  "required": ["start", "end"]
}
```

Wrapper defaults:

- `calendar_id = primary`
- identity = user
- output normalized to compact JSON

Output:

```json
{
  "ok": true,
  "events": [
    {
      "event_id": "xxx_0",
      "summary": "Project sync",
      "start": "2026-06-02T10:00:00+08:00",
      "end": "2026-06-02T10:30:00+08:00",
      "calendar": "primary",
      "app_link": "https://..."
    }
  ]
}
```

### `feishu_calendar_create`

Risk: write

Purpose: Create a calendar event.

Parameters:

```json
{
  "type": "object",
  "properties": {
    "summary": { "type": "string" },
    "start": { "type": "string" },
    "end": { "type": "string" },
    "description": { "type": "string" },
    "attendee_ids": { "type": "string" },
    "calendar_id": { "type": "string" }
  },
  "required": ["summary", "start", "end"]
}
```

Wrapper defaults:

- `calendar_id = primary`
- identity = user
- add idempotency key if supported

Policy:

- Allowed without confirmation only when the user explicitly asks to create/schedule/add an event.
- If time, title, or target calendar is ambiguous, ask before writing.

### `feishu_calendar_delete`

Risk: destructive write

Purpose: Delete a calendar event.

Parameters:

```json
{
  "type": "object",
  "properties": {
    "event_id": { "type": "string" },
    "calendar_id": { "type": "string" },
    "need_notification": { "type": "boolean" }
  },
  "required": ["event_id"]
}
```

Policy:

- Require explicit confirmation unless deleting an event created in the same current test/session and clearly marked as test.
- Default `need_notification = false` for test cleanup.

### `feishu_calendar_update`

Risk: write

Purpose: Update event title, time, description, or attendees.

Policy:

- Always show a before/after summary and require confirmation before execution.

### `feishu_contact_search`

Risk: read

Purpose: Search contacts before drafting messages or inviting attendees.

Parameters:

```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string" },
    "limit": { "type": "number" }
  },
  "required": ["query"]
}
```

### `feishu_message_draft`

Risk: read/compose

Purpose: Produce a message draft without sending.

Parameters:

```json
{
  "type": "object",
  "properties": {
    "recipient": { "type": "string" },
    "intent": { "type": "string" },
    "tone": {
      "type": "string",
      "enum": ["brief", "polite", "casual"]
    }
  },
  "required": ["recipient", "intent"]
}
```

### `feishu_message_send_confirmed`

Risk: external side effect

Purpose: Send an already confirmed message.

Policy:

- Never call unless the immediately preceding user turn confirms a specific draft.
- Confirmation must include recipient and final text.

### `send_text`

Risk: delivery

Purpose: Send text to the current user.

Parameters:

```json
{
  "type": "object",
  "properties": {
    "text": { "type": "string" }
  },
  "required": ["text"]
}
```

Runtime rule:

- On channel-delivered surfaces, direct assistant content should be transformed into `send_text` fallback, logged as a delivery fallback, and not sent twice.

## Role Behavior Rules

SecretaryCat prompt should enforce:

- Be brief and action-oriented.
- Do not announce capabilities.
- Use tools for real Feishu state.
- Never invent calendar/message/task/doc results.
- For personal Feishu data, prefer user identity.
- If auth is missing, start auth or ask the user to authorize.
- For writes, distinguish explicit commands from vague wishes.
- For message sending, draft first and require confirmation.
- For delete/update, require confirmation.
- After tool results, produce user-visible output through `send_text`.

## Example Multi-Turn Flows

### Query Calendar

User:

```text
帮我查一下明早 10 点附近有没有日程，直接告诉我结果。
```

Assistant tool call:

```json
{
  "name": "feishu_calendar_agenda",
  "arguments": {
    "start": "2026-06-02T09:30:00+08:00",
    "end": "2026-06-02T10:30:00+08:00"
  }
}
```

Tool result:

```json
{
  "ok": true,
  "events": []
}
```

Assistant tool call:

```json
{
  "name": "send_text",
  "arguments": {
    "text": "明早 10 点附近没有日程。"
  }
}
```

### Create Calendar Event

User:

```text
帮我明天上午 10 点建一个 Gemma4 XiaoBa 多轮测试，10 分钟。
```

Assistant tool call:

```json
{
  "name": "feishu_calendar_create",
  "arguments": {
    "summary": "Gemma4 XiaoBa 多轮测试",
    "start": "2026-06-02T10:00:00+08:00",
    "end": "2026-06-02T10:10:00+08:00"
  }
}
```

Tool result:

```json
{
  "ok": true,
  "event_id": "xxx_0",
  "summary": "Gemma4 XiaoBa 多轮测试",
  "start": "2026-06-02T10:00:00+08:00",
  "end": "2026-06-02T10:10:00+08:00"
}
```

Assistant tool call:

```json
{
  "name": "send_text",
  "arguments": {
    "text": "已创建“Gemma4 XiaoBa 多轮测试”，时间是明天 10:00-10:10。"
  }
}
```

### Missing Auth

Tool result:

```json
{
  "ok": false,
  "error": {
    "type": "calendar_user_login_required",
    "message": "User identity is missing."
  }
}
```

Assistant tool call:

```json
{
  "name": "feishu_auth_login_start",
  "arguments": {
    "domain": "calendar",
    "recommend": true
  }
}
```

Then call `send_text` with verification URL.

## Runtime Integration Requirements

### Role Files

Target implementation should add:

```text
roles/secretary-cat/
  README.md
  SPEC.md
  PLAN.md
  role.json
  prompts/
    secretary-system-prompt.md
  skills/
    daily-brief/SKILL.md
    message-drafting/SKILL.md
```

### Tool Registration

Add role-specific tools in `src/roles/runtime-role-registry.ts`:

```text
secretary-cat -> Feishu secretary tools only
```

Do not inherit EngineerCat/ReviewerCat code execution tools.

### Feishu CLI Wrapper Layer

Create a small wrapper module around `lark-cli`:

```text
src/roles/secretary-cat/tools/feishu-calendar-tools.ts
src/roles/secretary-cat/tools/feishu-auth-tools.ts
src/roles/secretary-cat/tools/feishu-message-tools.ts
src/roles/secretary-cat/utils/lark-cli-runner.ts
```

Wrapper responsibilities:

- Execute `lark-cli` with `execFile`, not shell string interpolation.
- Always request JSON output.
- Normalize lark-cli responses into compact stable JSON.
- Convert CLI/API errors into typed errors.
- Redact secrets and tokens from tool output.
- Enforce timeout and output-size limits.

### Delivery Fallback

If a legacy entrypoint explicitly opts into `deliveryFallbackFinalReply`, runtime may:

- Send that content through the channel.
- Log `delivery_fallback_final_reply`.
- Avoid duplicate final replies.

This is compatibility-only and should not be the normal SecretaryCat delivery path.

## Permissions

Default policy:

| Tool | Default |
| --- | --- |
| `feishu_auth_status` | allowed |
| `feishu_calendar_agenda` | allowed |
| `feishu_contact_search` | allowed |
| `feishu_message_draft` | allowed |
| `send_text` | allowed |
| `feishu_auth_login_start` | allowed with delivery |
| `feishu_calendar_create` | allowed only on explicit user request |
| `feishu_calendar_update` | confirmation required |
| `feishu_calendar_delete` | confirmation required |
| `feishu_message_send_confirmed` | confirmation required |
| raw shell / write file / edit file | not registered |

## Error Handling

Required typed errors:

- `AUTH_MISSING`
- `SCOPE_MISSING`
- `CLI_NOT_INSTALLED`
- `CLI_NOT_CONFIGURED`
- `API_ERROR`
- `VALIDATION_ERROR`
- `AMBIGUOUS_REQUEST`
- `WRITE_CONFIRMATION_REQUIRED`
- `TOOL_TIMEOUT`

Model-facing error output should be short and structured:

```json
{
  "ok": false,
  "error": {
    "code": "AUTH_MISSING",
    "message": "Feishu user identity is missing.",
    "next_action": "call feishu_auth_login_start with domain calendar"
  }
}
```

## MVP Acceptance Criteria

### Calendar Query

- Given "查明早 10 点附近有没有日程", the role calls `feishu_calendar_agenda`.
- It uses the correct local timezone and a sensible time window.
- Given an empty result, it calls `send_text` and says there is no event.
- Given one or more events, it calls `send_text` with a concise summary.

### Calendar Create

- Given "明天 10 点建一个 X，10 分钟", the role calls `feishu_calendar_create`.
- It uses correct start/end ISO timestamps.
- It does not ask for extra confirmation when the create intent is explicit.
- After success, it calls `send_text` with title and time.

### Missing Auth

- Given a calendar auth error, the role must not invent results.
- It calls `feishu_auth_login_start` or asks the user to authorize.
- Given an auth URL, it delivers it through `send_text`.

### Message Draft

- Given "帮我给张三发一句...", the role must not send directly.
- It drafts the message and asks for confirmation.

### Safety

- `execute_shell`, `write_file`, and `edit_file` are not available to `secretary-cat`.
- Calendar delete/update and message send require confirmation.

## Test Plan

### Unit Tests

- Wrapper command construction uses `execFile` argument arrays.
- JSON normalization handles lark-cli success and failure.
- Secrets are redacted.
- Date parsing is deterministic with injected current date/timezone.

### Runtime Harness Tests

- Tool call transcript remains OpenAI-compatible.
- Multi-turn tool result handling ends in `send_text`.
- Delivery fallback prevents silent direct content.
- Missing auth route produces auth flow.

### Real E2E Smoke

Manual or gated local test:

1. Check `lark-cli doctor`.
2. Query tomorrow empty range.
3. Create `[TEST] SecretaryCat calendar smoke`.
4. Query and verify event appears.
5. Delete the event.
6. Query and verify it is gone.

Do not run this in CI unless a dedicated Feishu test tenant is available.

## SFT Data Plan

Do not train first. Collect traces from MVP:

- User request
- Tool list
- Assistant tool call
- Tool result
- Assistant delivery
- Human correction if any

Useful future categories:

- Calendar query/create/update/delete
- Contact search ambiguity
- Message drafting and confirmation
- Auth missing/scope missing
- CLI/API errors
- Delivery mistakes
- Timezone/date edge cases

Initial target: 300-1000 high-quality trajectories before LoRA.

## Milestones

### M0: Wrapper Prototype

- Add Feishu calendar/auth wrapper tools.
- Run local manual tests.

### M1: SecretaryCat Role MVP

- Add `secretary-cat` role files.
- Register only secretary tools.
- Pass calendar query/create multi-turn tests.

### M2: Messaging Draft Flow

- Add contact search and message draft tools.
- Confirmation-only send path.

### M3: Daily Brief

- Add daily brief skill using agenda + tasks + notes.

### M4: SFT Readiness

- Export clean tool-use trajectories.
- Build eval set for tool routing and delivery correctness.

## Open Questions

- Should SecretaryCat live as `secretary-cat`, `personal-secretary`, or a branded pet name?
- Should create-event requests always create immediately, or should some surfaces require confirmation?
- Which Feishu domains should be in first user auth recommendation?
- Should Mac native reminders/calendar be integrated before Feishu task support?
- Should SecretaryCat have memory write access, and what fields are allowed?
