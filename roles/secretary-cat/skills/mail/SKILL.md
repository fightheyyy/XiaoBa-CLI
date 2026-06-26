---
name: mail
description: Use Feishu mail tools for inbox triage, reading messages, drafting mail, and confirmed draft sending.
aliases:
  - email
  - inbox
toolsets:
  - mail
---

# Mail

Use this skill when the user asks about Feishu mail, inbox triage, email reading, drafting, or sending.

Workflow:

1. Use `feishu_mail_triage` for inbox overview and `feishu_mail_read` for a specific message.
2. Use `feishu_mail_draft_create` to create drafts; show recipients, subject, and body to the user.
3. Only after explicit confirmation of the draft and recipients, call `feishu_mail_draft_send_confirmed`.

Execution discipline:

- When the needed tool is visible and required inputs are clear, call the tool. Do not narrate or simulate tool calls.
- Email addresses, 邮件, 收件箱, inbox, and mail draft/send requests belong to this skill, not message-drafting.
- When the latest user message explicitly confirms sending a draft and provides a draft ID, call the send-confirmed tool with `confirmed: true`. Do not ask for another confirmation.

Do not use Feishu IM message tools for mail requests.
