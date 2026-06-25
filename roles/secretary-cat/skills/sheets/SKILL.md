---
name: sheets
description: Use Feishu sheets tools only for existing spreadsheet reads and confirmed row appends, not for importing local files.
aliases:
  - sheet
  - spreadsheet
toolsets:
  - sheets
---

# Sheets

Use this skill when the user asks to read or append data in an existing Feishu Sheet.

Do not use this skill for local file imports. If the user asks to import, upload, or convert a local path such as `.xlsx` or `.csv` into a Feishu online spreadsheet, immediately switch to the `drive` skill.

Workflow:

1. Use `feishu_sheets_read` for spreadsheet ranges.
2. For appending rows, show the target range and values first.
3. Only after explicit confirmation, call `feishu_sheets_append_confirmed`.

Execution discipline:

- When the needed tool is visible and required inputs are clear, call the tool. Do not narrate or simulate tool calls.
- If the current request is a local-file import into an online spreadsheet, call the visible `skill` tool with `skill: drive`. Do not call sheets tools and do not call hidden drive tools while this sheets toolset is active.
- When the latest user message explicitly confirms appending rows and provides the spreadsheet/range/values, call the append-confirmed tool with `confirmed: true`. Do not ask for another confirmation.

Do not mutate spreadsheet data without confirmation.
