# XiaoBa-CLI Docs

`docs/` 是项目级和五大顶层模块的 spec / plan 真相源。

## Project

- [Project SPEC](SPEC.md)
- [Project PLAN](PLAN.md)

## Top-Level Modules

| 模块 | SPEC | PLAN |
| --- | --- | --- |
| Surfaces：入口层 | [SPEC](surfaces/SPEC.md) | [PLAN](surfaces/PLAN.md) |
| Harness Runtime：核心运行时 | [SPEC](harness/SPEC.md) | [PLAN](harness/PLAN.md) |
| Roles & Skills：策略层 | [SPEC](roles/SPEC.md) | [PLAN](roles/PLAN.md) |
| State & Evidence：状态证据层 | [SPEC](state-evidence/SPEC.md) | [PLAN](state-evidence/PLAN.md) |
| Evaluation Gates：评测回归层 | [SPEC](benchmarks/SPEC.md) | [PLAN](benchmarks/PLAN.md) |

## Maintenance

- 项目级正文只维护在 `docs/SPEC.md` / `docs/PLAN.md`。
- 不再把历史 proposal、ops、growth、archive 或 reference 文档放在 `docs/` 下。
- 更细的 durable 子模块文档继续保留在对应模块目录，例如 `dashboard/`、`roles/<role-name>/`、`benchmarks/BioBench/`。
