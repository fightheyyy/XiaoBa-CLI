# XiaoBa-CLI Docs

`docs/` 现在只保留项目级和五大顶层模块的 spec / plan 浏览入口。根目录和模块目录下的 `SPEC.md` / `PLAN.md` 仍作为工程治理入口保留；本目录提供集中阅读版本。

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

- 更新根目录或模块目录的 `SPEC.md` / `PLAN.md` 后，同步更新本目录副本。
- 不再把历史 proposal、ops、growth、archive 或 reference 文档放在 `docs/` 下。
- 更细的 durable 子模块文档继续保留在对应模块目录，例如 `dashboard/`、`roles/<role-name>/`、`benchmarks/BioBench/`。
