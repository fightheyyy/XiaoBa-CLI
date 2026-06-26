---
name: drive
description: Use Feishu Drive tools for cloud file search, upload, download, and confirmed import, including local files imported as online docs or sheets.
aliases:
  - cloud-drive
  - files
toolsets:
  - drive
---

# Drive

Use this skill when the user asks about Feishu Drive files, uploads, downloads, or importing local files into cloud docs.

Workflow:

1. Use `feishu_drive_search` for files and folders in Drive.
2. Use `feishu_drive_download` for download requests; overwrites require explicit confirmation.
3. For upload or import, show the local file and target location first.
4. Only after explicit confirmation, call `feishu_drive_upload_confirmed` or `feishu_drive_import_confirmed`.

Execution discipline:

- When the needed tool is visible and required inputs are clear, call the tool. Do not narrate or simulate tool calls.
- Cloud-space, cloud-drive, file/folder token, local-file upload, local-file download, and local-file import requests belong here, not to docs or sheets.
- Importing a local `.xlsx`, `.csv`, `.md`, `.docx`, or `.pptx` path into a Feishu online spreadsheet/document is a Drive import workflow. Do not switch to the sheets or docs skill for that request.
- When the latest user message explicitly confirms an upload/import and provides the local path plus target folder or import name, call the matching confirmed tool with `confirmed: true`. Do not ask for another confirmation.
- When the latest user message explicitly confirms importing a local path into an online Feishu file and provides the output name, call `feishu_drive_import_confirmed` with `confirmed: true`.

Do not use docs search for generic Drive file search.
