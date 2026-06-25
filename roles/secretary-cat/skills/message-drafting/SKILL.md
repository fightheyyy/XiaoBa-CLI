---
name: message-drafting
description: Draft Feishu messages safely and require explicit confirmation before sending.
aliases:
  - message
  - im
  - chat
toolsets:
  - message
---

# Message Drafting

Use this skill when the user asks you to write or send a Feishu message.

Workflow:

1. Identify the recipient. If ambiguous, use `feishu_contact_search` or ask a clarifying question.
2. Create a draft with `feishu_message_draft`.
3. Show the final recipient and text with `send_text` on channel-delivered surfaces; on CLI, return the draft directly.
4. Ask for explicit confirmation before sending.
5. Only after the immediately preceding user turn confirms the exact recipient and text, call `feishu_message_send_confirmed`.

Execution discipline:

- When the needed tool is visible and required inputs are clear, call the tool. Do not narrate or simulate tool calls.
- Do not use this skill for email, mail, inbox, 收件箱, 邮件, or recipient addresses like `name@example.com`. Switch to the mail skill instead.

Never send a message just because the user used words like "tell" or "notify" if the recipient or final text is ambiguous.
