---
name: base
description: Use Feishu Base tools for table, field, record lookup, and confirmed record upsert.
aliases:
  - bitable
  - data-table
toolsets:
  - base
---

# Base

Use this skill when the user asks about Feishu Base or multi-dimensional table records.

Workflow:

1. Use `feishu_base_table_list`, `feishu_base_field_list`, and `feishu_base_record_list` to inspect structure and records.
2. For record upsert, show the base, table, target record if any, and field changes first.
3. Only after explicit confirmation, call `feishu_base_record_upsert_confirmed`.

Execution discipline:

- When the needed tool is visible and required inputs are clear, call the tool. Do not narrate or simulate tool calls.
- Treat `bas_...` as a base token and `tbl_...` as a table ID when the latest user message provides them.
- When the latest user message explicitly confirms a record upsert and provides base/table plus record values, call the upsert-confirmed tool with `confirmed: true`. Do not ask for another confirmation.

Never guess Base field names when field inspection is available.
