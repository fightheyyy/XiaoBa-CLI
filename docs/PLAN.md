# XiaoBa-CLI PLAN

状态：Active
最后更新：2026-07-20
Owner：XiaoBa maintainers

本文只维护仓库级当前状态和收敛顺序。历史实现流水由 Git 保存；模块细节进入六份模块 PLAN，不再创建额外计划文档。

## Current Status

XiaoBa-CLI 已形成一套共享 Agent Runtime，以及一个 Base Main Agent + 八个默认 Role Subagents：

- 四个功能型 Role：EngineerCat、BrowserCat、GuiCat、SecretaryCat（FeishuCat 别名），直接接管用户任务。
- 四个内部持续改进 Role：UserCat、InspectorCat、EvolutionCat、ReviewerCat，按需参与评测、自进化与正式回放。
- 4 + 4 只是责任和启动方式分组；八个 Role 仍复用同一 Agent loop，不建立第二套控制平面。
- EvolutionCat 在内部组中独占确定性 `remember` tool 和三个演化/发布 role-local Skills。
- EngineerCat 同时承担代码接管，以及 Inspector / Reviewer 闭环里的修复执行。
- 八个角色全部复用 XiaoBa Agent loop；browser/GUI/Feishu drivers 只是确定性 capability adapters。
- CLI、Feishu、Weixin、Pet、Dashboard 和 Electron 共用 AgentSession/ConversationRunner 主链。
- 本地 trace、artifact、delivery evidence、Trace Replay、Live Agent Eval 和 Arena 已有可运行边界。
- Nightly evolution now runs a fixed Inspector-first DAG: runtime harvests once, InspectorCat emits one typed route, and the deterministic gate awaits EvolutionCat, EngineerCat, ReviewerCat or `no_op` without entering Base.
- Repair routes now pin one `base_commit`, run EngineerCat and ReviewerCat in a detached Git worktree, confine scheduled Engineer Shell writes to that worktree with macOS Seatbelt, retain a content-addressed Patch Candidate, and send behavior-impacting repairs through Arena `repair_regression` without mutating the scheduler checkout.

文档已收敛为固定 14 份：项目级 SPEC/PLAN，加六个模块 SPEC/PLAN。Prompt、`SKILL.md` 和测试 fixture 属于运行时源文件，不是架构文档。

```mermaid
flowchart LR
    Surface["Surface"] --> Runtime["Agent Runtime"]
    Roles["Roles & Skills<br/>Base + 4 functional + 4 internal roles"] --> Runtime
    Runtime --> Evidence["Observability & Evidence"]
    Evidence --> Evaluation["Evaluation"]
    Roles --> Arena["Arena<br/>候选能力验收"]
    Arena --> Evidence
```

## Milestones

| Milestone | Status | Current meaning |
| --- | --- | --- |
| M0 Documentation baseline | Completed | 1 repository pair + 6 module pairs; no duplicate submodule SPEC/PLAN |
| M1 Shared runtime | Completed | AgentSession、ConversationRunner、layered ToolManager and provider adapters are active |
| M2 Base + eight roles | Completed | Stable topology and default bundle implemented; EvolutionCat owns capability evolution; RouterCat remains retired |
| M3 Surface integration | Partial | Maintained entrypoints share runtime; network auth/permission remains incomplete |
| M4 Evidence system | Partial | Local trace/artifact/delivery facts exist; retention and durable recovery remain incomplete |
| M5 Evaluation split | Completed | Test、Trace Replay and Live Agent Eval have distinct commands and meanings |
| M6 Arena | Partial | Clean runtime, three review modes, content-addressed subjects, all-turn contracts and evidence-bound manual promotion exist; sandbox hardening remains |
| M7 Browser/GUI takeover | Partial | Typed adapters and pinned official role-local Skills exist; GuiCat's macOS driver package was built and inspected, while BrowserCat packaging, broader coverage and trusted approvals remain |
| M8 EvolutionCat ownership | Completed | Eighth default role, zero bundled Base Skills, deterministic role-scoped `remember`, three EvolutionCat-local Skills and exact-hash desktop migration are implemented |
| M9 Nightly evolution foundation | Completed | Structured child traces, deterministic harvest, cron management, worker supervision and PID-owned lock cleanup are implemented |
| M10 Inspector-first evolution DAG | Completed | No-Base typed routing, isolated Skill/Role and Patch Candidates, Reviewer risk classification, capability Arena intake and conditional Patch regression are implemented |

## Next Steps

1. Finish BrowserCat packaged drivers and broaden BrowserCat/GuiCat real-task verification without adding another model loop.
2. Add Owner-bound authentication and consequential-action confirmation to Dashboard, Pet, Bridge and shared tool context.
3. Persist in-flight subagent state, action receipts and cancellation evidence without introducing a general workflow framework.
4. Make Trace Replay side-effect safe before replaying arbitrary historical tasks.
5. Keep Live Agent Eval fresh-run only; add role cases only when they have task-specific hard verifiers.
6. Harden Arena isolation while preserving the implemented evidence-bound, explicit human promotion gate for external skills and roles.
7. Broaden the real-provider proof across both `evolution` and isolated `repair` routes, providers, seeds and time windows without weakening the deterministic contract or permitting same-run back edges.
8. Simplify SecretaryCat's typed-wrapper compatibility layer against official `lark-cli` skills without weakening Owner confirmation, delivery or evidence.

## Owners

- Surface：`src/commands/**`, `src/feishu/**`, `src/weixin/**`, `src/pet/**`, `src/dashboard/**`, `desktop/**`
- Agent Runtime：`src/core/**`, `src/providers/**`, `src/tools/**`, `src/types/**`
- Roles & Skills：`roles/**`, `src/roles/**`, `skills/**`, `src/skills/**`, `prompts/**`
- Observability & Evidence：`src/observability/**`, `logs/**`, `data/**`, `memory/**`, `output/**`
- Evaluation：`test/**`, `src/replay/**`, `src/eval/**`, `eval/**`
- Arena：`src/arena/**`, `src/commands/arena.ts`, `arena/**`

## Acceptance Criteria

- Only `docs/SPEC.md` plus the six module SPECs define architecture.
- Only their paired PLAN files maintain current execution status.
- Every maintained SPEC has truthful Current Architecture and Target Architecture Mermaid diagrams.
- Base remains the only user-facing main agent and dispatcher.
- Exactly eight default roles share the XiaoBa Agent loop.
- Scheduled evolution starts with InspectorCat, never Base, and accepts only `evolution | repair | replay | no_op`.
- Evolution candidates remain isolated and `candidate` until Arena evidence plus explicit promotion; `blocked` assets are never callable.
- ReviewerCat terminates formal replay as `closed | next_run | blocked`; the same DAG run cannot route back to EngineerCat.
- EngineerCat never edits the scheduler checkout in a scheduled Repair run; `fixed` requires a non-empty content-addressed Patch Candidate bound to one `base_commit`.
- ReviewerCat must classify a closed Patch Candidate as `arena_review=required|not_required`; required candidates pass multi-attempt Arena repair regression before closure.
- Browser/GUI drivers do not expose upstream Chat/Agent/MCP loops.
- Tool, delivery, artifact and runtime failures remain structured and observable.
- `test:*`, `replay:*`, `eval:*` and `check:*` commands keep distinct meanings.
- Arena subjects remain untrusted until explicit promotion.

## Risks / Open Questions

- Dashboard/Pet/Bridge control surfaces are not yet safe for broad network exposure.
- Owner identity and high-risk confirmation are not consistently bound through runtime execution context.
- In-flight subagent recovery, idempotent side effects and full cancellation remain incomplete.
- Trace Replay can still execute current real side effects.
- Browser release packaging and Browser/GUI trusted approval provenance remain incomplete; GuiCat's local macOS package path and artifact are verified, but signed/notarized release verification remains future release work.
- SecretaryCat's compatibility wrappers can drift from the official `lark-cli` command and skill surface.
- `npm audit --omit=dev` reports 7 production-tree findings (3 moderate, 4 high) in the existing Lark SDK/transitive dependency path; Peekaboo is not among the flagged packages, but release dependency remediation remains open.
- Arena sandbox claims must stay narrower than the actual OS isolation it enforces.
- The isolated Repair path has deterministic coverage but still needs a preserved real-provider closed-loop proof before broad autonomous code-repair claims.

## Recent Verification

- Documentation set check：14 architecture/plan files under `docs/`；post-change Git Markdown inventory is 61 files, consisting of 20 human docs, 38 runtime prompt/skill assets, and 3 test fixture reports。
- Human-document local link/asset check：64/64 resolved across 20 maintained human-facing Markdown files, including README images and the `requirement.txt` links。
- Full repository tests：654/654 passed across 100 suites；the isolated Patch Candidate, conditional Patch regression, worktree Shell write boundary, Inspector-first DAG, Arena-run-wide Trace identity gate, all-turn Arena contract, source-task binding, semantic re-attestation, raw-evidence-bound promotion and subagent regressions are included。
- `npm run build` passed；benchmark preflight passed for 1 manifest / 11 cases；BrowserCat and GuiCat Skill validation passed。
- Roles & Skills current/target Mermaid diagrams rendered successfully after the target map was simplified to the eight-role ownership boundary。
- Repository current/target Mermaid diagrams were simplified to six module-level columns, and both repository and Surface diagram pairs rendered successfully with the ordinary AgentSession, scheduled evolution DAG and explicit Promote control lanes kept distinct。
- Feishu Surface 与 SecretaryCat 的 App ID 指纹一致；SecretaryCat 已显式绑定同应用 profile，真实状态为 bot ready / user missing。BrowserCat 当前缺少固定 driver。GuiCat 从项目 optional dependency 发现 Peekaboo 3.8.0，macOS/TCC/bridge 检查为 `ready=true`。
- GuiCat real read-only smoke passed through its typed adapter and returned a non-empty application inventory without claiming the desktop lease.
- GuiCat's role-local `SKILL.md` is an exact vendored copy of official `openclaw/Peekaboo` commit `ed1a7218` (SHA-256 `0bfe8b25ef9ac2ffc99c7135ddc3b7258abb0a41da0bbeeb9c27d1faa52f2d28`) with the upstream MIT LICENSE.
- BrowserCat's role-local `core/SKILL.md` is an exact vendored copy of official `vercel-labs/agent-browser` tag `v0.31.1` / commit `ed2e1059` (SHA-256 `cc5ec94697530e750bcb9776479d71ef7966e7cf874b9a60b091a986b1ae5b9d`) with the upstream Apache-2.0 LICENSE; it loads through role-local SkillManager without exposing shell, raw CLI, Chat/Agent or MCP tools.
- The duplicate Base `agent-browser` routing Skill and four legacy evolution Base Skills are retired; Base dispatches roles only for ordinary user conversations, and the default package contains zero Base Skills.
- A real-provider nightly E2E ran runtime harvest → InspectorCat → `no_op` directly. Its child trace records `role_name=inspector-cat` and parent `evolution:dag:1999-01-02`; no Base session or EvolutionCat invocation was created.
- A current-contract real-provider closed loop ran two independent failing Pet sessions (0/2) → InspectorCat `evolution` route → EvolutionCat Candidate Skill → Arena `pass` across 3 independent UserCat sessions / 7 turns (identity 3/3, contract 7/7, 0 violations) → explicit `xiaoba evolution promote` receipt with 7 exact raw-evidence hashes, including the Inspector cases and Arena runner config → two fresh Pet retests (2/2). Every Arena and post-promotion turn was bound to `evo-closeout-v2-formatter`; an earlier generated revision was correctly rejected as `unstable`, and a same-date nightly rerun preserved receipt and production hashes. The self-verifying proof is under `output/evolution/proofs/2026-07-15-evo-closeout-v3/` and remains outside tracked product assets.
- Deterministic DAG tests cover all four routes, invalid-contract fail-closed behavior, isolated Candidate Skill/Role/Patch intake, protected evaluator paths, Reviewer Arena risk classification, conditional Patch regression, formal replay terminals and same-run back-edge rejection.
- `electron-builder --mac --dir` passed；产物中不再包含 Base `skills/agent-browser`，BrowserCat role-local Skill / LICENSE hashes match the source copy；Peekaboo 位于 `Contents/Resources/drivers/peekaboo/peekaboo`，版本 3.8.0，使用 packaged resources 路径复检仍为 `ready=true`。
- `npm audit --omit=dev` found 7 existing production-tree findings；none names `@steipete/peekaboo`。
- JSON parse checks and `git diff --check` passed。
