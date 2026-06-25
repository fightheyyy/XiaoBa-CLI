# SecretaryCat

SecretaryCat is a local personal secretary role for XiaoBa Runtime. It uses Feishu-first typed wrapper tools for calendar, auth, contact lookup, messages, tasks, mail, minutes, docs, drive, sheets, base, and daily brief workflows.

## Use

```bash
xiaoba chat --role secretary-cat -m "Check whether I have anything around 10 tomorrow morning."
xiaoba chat --role secretary-cat -m "Create a 10-minute test event tomorrow at 10."
xiaoba chat --role secretary-cat -m "Draft a short Feishu message to Zhang San."
```

Recommended local model config:

```env
XIAOBA_LLM_PROVIDER=openai
XIAOBA_LLM_API_BASE=http://127.0.0.1:11434/v1
XIAOBA_LLM_API_KEY=ollama
XIAOBA_LLM_MODEL=gemma4:e4b-mlx
```

## Tools

SecretaryCat receives Feishu wrapper tools from `src/roles/secretary-cat/**`:

- `feishu_auth_status`
- `feishu_auth_login_start`
- `feishu_auth_login_complete`
- `feishu_calendar_agenda`
- `feishu_calendar_create`
- `feishu_calendar_update`
- `feishu_calendar_delete`
- `feishu_contact_search`
- `feishu_message_draft`
- `feishu_message_send_confirmed`
- `feishu_task_list`
- `feishu_task_create_confirmed`
- `feishu_task_update_confirmed`
- `feishu_task_state_confirmed`
- `feishu_mail_triage`
- `feishu_mail_read`
- `feishu_mail_draft_create`
- `feishu_mail_draft_send_confirmed`
- `feishu_minutes_search`
- `feishu_minutes_get`
- `feishu_minutes_notes`
- `feishu_minutes_download`
- `feishu_docs_search`
- `feishu_docs_fetch`
- `feishu_docs_create_confirmed`
- `feishu_docs_update_confirmed`
- `feishu_drive_search`
- `feishu_drive_upload_confirmed`
- `feishu_drive_download`
- `feishu_drive_import_confirmed`
- `feishu_sheets_read`
- `feishu_sheets_append_confirmed`
- `feishu_base_table_list`
- `feishu_base_field_list`
- `feishu_base_record_list`
- `feishu_base_record_upsert_confirmed`

The role must not receive raw `execute_shell`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`, or sub-agent tools for secretary workflows. `send_text` and `send_file` are surface delivery tools: they are available only on channel-backed surfaces, not in CLI role chat.

## Safety Rules

- Calendar queries must use real Feishu state.
- Calendar create is allowed only for explicit create/schedule requests.
- Calendar update/delete requires explicit confirmation.
- Message sending requires an explicit confirmed recipient and final text.
- Task mutations, mail sending, docs edits, drive uploads/imports, sheets appends, and base record writes require explicit confirmation.
- Mail draft creation is allowed as a draft-only helper; sending the draft is confirmation-gated.
- Missing Feishu auth must be surfaced through the auth flow; results must not be invented.

Auth recovery uses a two-step device flow:

1. `feishu_auth_status` checks whether the user identity is ready, missing, or expired.
2. `feishu_auth_login_start` returns the browser verification URL, user code, and an `auth_request_id`; raw device codes are stored locally and are not returned to the model.
3. After the user completes browser authorization, `feishu_auth_login_complete` uses the `auth_request_id` to finish `lark-cli auth login --device-code ... --json`.

## Runtime Boundary

SecretaryCat is a role, not a separate runtime. It runs on the shared XiaoBa harness and gets role assets from `roles/secretary-cat/` plus role-specific wrapper tools from `src/roles/secretary-cat/`.
