# Root Folder Structure

状态：Active
最后更新：2026-06-18

本文解释根目录为什么看起来不等于五个模块目录，以及每个根目录应该归到哪一层。项目的逻辑架构以 `docs/SPEC.md` 的五大模块为准；根目录还必须同时容纳源码、角色资产、运行证据、构建产物和评测资产。

## Five Module Docs

`docs/` 下面按五个模块命名：

```text
docs/
  surface/
  agent-runtime/
  roles-skills/
  observability-evidence/
    state-evidence/
  evaluation/
    benchmarks/
```

`docs/evaluation/` 是 Evaluation 的文档入口代理，真实 eval 实现和维护源在 `eval/`。

## Root Directory Map

| 根目录 | 归属模块 | 用途 |
| --- | --- | --- |
| `src/commands`、`src/feishu`、`src/weixin`、`src/pet`、`src/dashboard` | Surface | 平台入口、事件解析、channel callbacks、用户可见交付 |
| `dashboard`、`electron` | Surface | Dashboard 静态页面、桌面壳和 pet runtime assets |
| `src/core`、`src/providers`、`src/tools`、`src/types`、`src/agents`、`src/bootstrap`、`src/bridge` | Agent Runtime | session lifecycle、agent loop、provider adapter、tool boundary、subagent/runtime glue |
| `roles`、`src/roles`、`skills`、`src/skills`、`prompts` | Roles & Skills | 角色定义、role-local prompt/skill、共享 skill、策略层资产 |
| `src/observability`、`logs`、`data`、`memory`、`output`、`.omc`、`.codex-pet-runs` | Observability & Evidence | 本地 trace/log/state/memory/artifact evidence 和运行输出 |
| `eval`、`src/eval`、`test` | Evaluation | eval control plane、benchmark source、runner/verifier/scorecard、deterministic verification boundary |
| `scripts`、`tools` | Developer Operations | 本地脚本和辅助工具 |
| `assets`、`build-resources`、`dist`、`node_modules` | Build / Package | 图片资源、打包资源、编译输出、依赖安装目录 |
| `docs` | Documentation | 项目级和五模块 spec / plan 真相源 |

## Reading Rule

- 想理解架构：先读 `docs/SPEC.md`，再读五个模块目录。
- 想找实现：按上表从模块映射到根目录。
- 想找 eval case：从 `docs/evaluation/SPEC.md` 进入，再看 `eval/` 和 `eval/benchmarks/`。
- 想找运行证据：先看 `docs/observability-evidence/SPEC.md`，再看 `logs`、`data`、`memory`、`output`。

## Non-Module Roots

这些目录不应该被当作第六个架构模块：

- `dist`：构建输出。
- `node_modules`：依赖安装目录。
- `assets` / `build-resources`：产品和打包资源。
- `scripts` / `tools`：开发和运维入口；GitHub workflow 当前已移除。
- `.omc` / `.codex-pet-runs`：本地运行产物或工具产物。
