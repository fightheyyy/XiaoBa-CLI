# XiaoBa-CLI Docs

`docs/` 是项目级和顶层架构模块的 spec / plan 真相源。当前顶层口径是六个模块：Surface、Agent Runtime、Roles & Skills、Observability & Evidence、Evaluation、Arena。`test/` 是 Evaluation 消费的 deterministic verification boundary；`state-evidence` 是 Observability & Evidence 的 durable source 子文档。

## Project

- [Project SPEC](SPEC.md)
- [Project PLAN](PLAN.md)
- [Root Folder Structure](ROOT_STRUCTURE.md)

## Top-Level Modules

| 模块 | SPEC | PLAN |
| --- | --- | --- |
| Surface：入口层 | [SPEC](surface/SPEC.md) | [PLAN](surface/PLAN.md) |
| Agent Runtime：会话与工具编排 | [SPEC](agent-runtime/SPEC.md) | [PLAN](agent-runtime/PLAN.md) |
| Roles & Skills：策略层 | [SPEC](roles-skills/SPEC.md) | [PLAN](roles-skills/PLAN.md) |
| Observability & Evidence：观测证据层 | [SPEC](observability-evidence/SPEC.md) | [PLAN](observability-evidence/PLAN.md) |
| Evaluation：评测与回归门禁 | [SPEC](evaluation/SPEC.md) | [PLAN](evaluation/PLAN.md) |
| Arena：能力审判场 | [SPEC](arena/SPEC.md) | [PLAN](arena/PLAN.md) |

## Supporting Docs

- [State & Evidence SPEC](observability-evidence/state-evidence/SPEC.md)
- [State & Evidence PLAN](observability-evidence/state-evidence/PLAN.md)
- [Harness Extraction SPEC](agent-runtime/HARNESS-EXTRACTION-SPEC.md)
- [Test Harness SPEC](../test/SPEC.md)
- [Test Harness PLAN](../test/PLAN.md)

## Maintenance

- 项目级正文只维护在 `docs/SPEC.md` / `docs/PLAN.md`。
- 根目录物理结构解释维护在 `docs/ROOT_STRUCTURE.md`；不要把 build output、local evidence、automation scripts 或 package assets 解释成新的架构模块。
- 不再把历史 proposal、ops、growth、archive 或 reference 文档放在 `docs/` 下。
- 更细的 durable 子模块文档继续保留在对应模块目录，例如 `dashboard/`、`roles/<role-name>/`、`test/`、`eval/`、`eval/benchmarks/BaseRuntime/`。
