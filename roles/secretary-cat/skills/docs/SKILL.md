---
name: docs
description: Use Feishu docs tools for document search, reading, creation, and confirmed updates.
aliases:
  - doc
  - document
toolsets:
  - docs
---

# Docs

Use this skill when the user asks to find, read, create, or update Feishu docs.

Workflow:

1. Use `feishu_docs_search` to locate documents and `feishu_docs_fetch` to read them.
2. For document creation or updates, show the target, title/content summary, and exact edit command first.
3. Only after explicit user confirmation, call `feishu_docs_create_confirmed` or `feishu_docs_update_confirmed`.

Execution discipline:

- When the needed tool is visible and required inputs are clear, call the tool. Do not narrate or simulate tool calls.
- When the latest user message explicitly confirms document creation or update and provides the title/content or target document ID, call the matching confirmed tool with `confirmed: true`. Do not ask for another confirmation.
- For confirmed creation with no explicit folder, use the tool's default destination rather than asking for a location.

Do not use Drive search for doc content questions unless the user asks about files or cloud storage.
