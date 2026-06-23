# Observability Evidence System PLAN

状态：Active
最后更新：2026-06-23
Owner：runtime / state-evidence maintainers

## Current Status

Observability has been slimmed to one evidence system. The retained core is durable session JSONL as local truth, a `session-log-projector` for local summary, and local trace timeline evidence. Trace proposal and trace-continuity are no longer part of the current product architecture.

2026-06-23：Local session evidence is now faithful local truth. `SessionTurnLogger` preserves user text, assistant text, tool arguments/results, delivery evidence, external receipts, runtime logs, and embedded runtime events before writing `traces.jsonl` / `runtime.log`. The old local policy layer was removed; benchmark cases are created by explicit benchmark-owner rewriting, not by mutating the local evidence source.

Previously separate source-acceptance and curation workflows are outside the current architecture. Observability can explain local runtime facts, but accepted benchmark source must be authored explicitly by BaseRuntime maintainers or a future owning live Role Benchmark.

Dashboard no longer exposes a user-facing observability panel. The backend API remains read-only for local summary and review state.

2026-06-12：First unification pass landed. `SessionTurnLogger` now projects appended JSONL entries through `session-log-projector`; `AgentSession` records session lifecycle facts as runtime events and configures its `ConversationRunner` as mirror-only for metrics, so local summary facts come from the durable session log instead of a parallel runtime metric stream.

2026-06-16：Session-log-v3 trace layout landed. One user request until its owning `ConversationRunner` while-loop stops is now the `trace`; `turn` is reserved for the while-loop iteration. New live logs write `logs/sessions/<surface>/<date>/<session_id>/traces.jsonl` with one trace row per user request, embed lifecycle/provider runtime events in that row, and write plain human runtime text to sibling `runtime.log`. Local summary allowlists `xiaoba.trace.*` attributes.

## Milestones

- M1：External exporter mirror removed from current local-first observability：done。
- M2：Local summary API with SLO/drilldown/trace timeline：done。
- M3：Local trace/log pre-write policy layer removed from observability：done。
- M4：Trace-to-case proposal diagnostics：removed from current architecture。
- M5：Trace continuity diagnostics：removed from current architecture。
- M6：Remove source-acceptance lifecycle from default architecture：done for scripts, schemas, dashboard actions, role tool registration and docs。
- M7：Session JSONL as local observability truth：partial; AgentSession path now projects local summary from session log, while standalone Runner still uses direct observability helpers.

## Next Steps

- Move remaining direct local metric writers behind either session-log projection or explicit standalone-runner mode.
- Decide later whether lifecycle event names (`session_started` / `session_completed`) should be renamed to trace lifecycle names; the v3 storage boundary is already trace-first.
- Consider adding model-call duration facts to session runtime events if local summary needs model latency without direct Runner local metrics.
- Keep benchmark source creation explicit and owner-authored; observability must not generate candidate benchmark packets.

## Acceptance Criteria

- `npm run eval:gate` runs only live agent eval, currently BaseRuntime.
- `npm run check:benchmarks` validates live benchmark manifests and referenced suite cases without restoring old central source-acceptance outputs.
- Dashboard exposes no observability action endpoint; only summary/review reads remain.
- No observability command can mark a benchmark case accepted.
- Local trace evidence remains faithful local truth; benchmark source admission requires an explicit live agent eval case rewrite.
- AgentSession local summary facts can be traced back to `logs/sessions/<surface>/<date>/<session_id>/traces.jsonl` trace rows and embedded runtime events.

## Verification Log

- 2026-06-23：Removed trace-proposal / trace-continuity from the current observability product path: deleted old runners/scripts, removed Dashboard `/api/observability/actions`, and kept `/api/observability/review` readonly. Verification：`node --test -r tsx test/dashboard-observability-api.test.ts`（3/3）；`npm run build`。
- 2026-06-23：Session visibility projection aligned with explicit channel delivery evidence. `session_completed` runtime events and local session span attrs now distinguish `xiaoba.session.visible_to_user` from `xiaoba.session.final_response_visible`, so successful `send_text` / `send_file` evidence makes the session user-visible even when final assistant text is hidden. Verification：`node --test -r tsx test/agent-session-log.test.ts test/observability.test.ts test/pet-channel.test.ts test/room-channel-history.test.ts`（35/35）；`npm run build`。
- 2026-06-23：Aligned Observability acceptance with the live-agent-eval-only boundary: `eval:gate` is BaseRuntime live eval, `check:benchmarks` is manifest/case preflight, and observability evidence cannot accept benchmark source. Verification：`npm run check:benchmarks`（1 manifest，11 cases）；`npm run eval:gate`（1/1 items，11/11 cases）；`npm run test:contract-smoke`（10/10 items，34/34 cases）；`npm run build`；`git diff --check`。
- 2026-06-23：Removed the local trace/log pre-write policy layer; local traces and explicitly recorded previews now preserve raw local evidence, Dashboard observability actions only expose trace proposal / trace continuity, and benchmark source admission remains an explicit owner rewrite. Verification：`node --test -r tsx test/logger.test.ts test/agent-session-log.test.ts test/observability.test.ts test/dashboard-observability-api.test.ts test/room-channel-history.test.ts`（31/31）；`npm run build`；`git diff --check`。
- 2026-06-09：Slimmed observability to one evidence system and removed old action/suite/schema/script assets from the default architecture. Verification：`npm run build`; `node --test -r tsx test/eval-schema-validation.test.ts`.
- 2026-06-10：Renamed remaining observability candidate language around owner-reviewed source edits rather than source acceptance. Verification：`node --test -r tsx test/dashboard-observability-api.test.ts test/eval-schema-validation.test.ts` (65/65); `npm run build`; `npm run check:eval-assets` (4769/4769); `npm run test:contract-smoke` (10/10 items, 34/34 cases); `npm run eval:role-benchmarks` (10/10 items, 88/88 cases); `git diff --check`.
- 2026-06-12：Added `session-log-projector`, wired `SessionTurnLogger` JSONL append into local summary projection, added mirror-only metrics for AgentSession-owned `ConversationRunner`, and updated observability source contract. Verification：`npm run build`; `node --test -r tsx test/logger.test.ts test/observability.test.ts test/dashboard-observability-api.test.ts` (24/24); `npm run eval:gate` (20/20 items, 122/122 cases); `npm run check:eval-assets` (4738/4739 passed, 1 optional skip).
- 2026-06-16：Implemented session-log-v3 trace layout: `traces.jsonl` is the machine-readable main ledger, `runtime.log` is human-readable, lifecycle/provider events embed into trace rows, projector emits `xiaoba.trace.*`, and live AgentSession state boundaries now reference `session-log-v3`. Verification：`npm run build`; `node --test -r tsx test/logger.test.ts test/agent-session-log.test.ts test/provider-network-readiness-runner.test.ts test/pet-channel.test.ts test/researcher-live-agent-session.test.ts test/room-channel-history.test.ts` (37/37).
