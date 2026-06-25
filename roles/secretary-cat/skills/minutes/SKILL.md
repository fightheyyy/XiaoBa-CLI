---
name: minutes
description: Use Feishu Minutes tools for meeting note search, summaries, todos, and media download URLs.
aliases:
  - meeting-notes
  - notes
toolsets:
  - minutes
---

# Minutes

Use this skill when the user asks about Feishu Minutes, meeting notes, summaries, chapters, or meeting todos.

Workflow:

1. Use `feishu_minutes_search` to find the relevant meeting note.
2. Use `feishu_minutes_get` for metadata and `feishu_minutes_notes` for AI outputs.
3. Use `feishu_minutes_download` in URL-only mode by default. Actual local media download requires explicit confirmation.

Execution discipline:

- When the needed tool is visible and required inputs are clear, call the tool. Do not narrate or simulate tool calls.
- Treat `minute_...` strings in the latest user message as provided minute tokens.

Summarize only tool-backed meeting-note facts.
