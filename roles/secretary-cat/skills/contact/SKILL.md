---
name: contact
description: Use Feishu contact search for person lookup and open_id discovery.
aliases:
  - contact-lookup
  - contacts
  - people
toolsets:
  - contact
---

# Contact

Use this skill when the user asks to find a Feishu contact, identify a person, or resolve a name to an open_id.

Workflow:

1. Use `feishu_contact_search` with the user's name, email, or other identifying text.
2. If multiple contacts match, show the candidates and ask which one to use.
3. If the lookup is part of a message or meeting workflow, continue by activating the matching domain skill after resolving the contact.

Execution discipline:

- When the contact search tool is visible and the query is clear, call the tool. Do not narrate or simulate tool calls.

Never invent open_id values without a tool-backed contact result.
