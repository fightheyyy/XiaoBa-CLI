# Root Folder Structure

状态：Active
最后更新：2026-07-05

本文解释根目录为什么看起来不等于顶层模块目录，以及每个根目录应该归到哪一层。项目的逻辑架构以 `docs/SPEC.md` 的六个顶层模块为准；根目录还必须同时容纳源码、角色资产、运行证据、构建产物和评测资产。

## Module Docs

`docs/` 下面按顶层模块命名：

```text
docs/
  surface/
  agent-runtime/
  roles-skills/
  observability-evidence/
    state-evidence/
  evaluation/
    benchmarks/
  arena/
```

`docs/evaluation/` 是 Evaluation 的文档入口代理，真实 eval 实现和维护源在 `eval/`。

## Root Directory Map

| 根目录 | 归属模块 | 用途 |
| --- | --- | --- |
| `src/commands`、`src/feishu`、`src/weixin`、`src/pet`、`src/dashboard` | Surface | 平台入口、事件解析、channel callbacks、用户可见交付 |
| `desktop` | Surface / Build | Dashboard 静态页面、Electron 桌面壳、桌面打包图标和内嵌 Node 资源 |
| `src/core`、`src/providers`、`src/tools`、`src/types`、`src/agents`、`src/bootstrap`、`src/bridge` | Agent Runtime | session lifecycle、agent loop、provider adapter、tool boundary、subagent/runtime glue |
| `roles`、`src/roles`、`skills`、`src/skills`、`prompts` | Roles & Skills | 角色定义、role-local prompt/skill、共享 skill、策略层资产 |
| `src/observability`、`logs`、`data`、`memory`、`output`、`.omc`、`.codex-pet-runs` | Observability & Evidence | 本地 trace/log/state/memory/artifact evidence 和运行输出 |
| `eval`、`src/eval`、`test` | Evaluation | eval control plane、benchmark source、runner/verifier/scorecard、deterministic verification boundary |
| `src/arena`、root `arena` | Arena | Arena 代码、真实评测现场、subject manifest、clean runtime、arena run index 和现有 UserCat / trace / Reviewer / eval 证据引用 |
| `scripts`、`tools` | Developer Operations | 本地脚本和辅助工具 |
| `assets`、`dist`、`node_modules` | Build / Package | README / 品牌图片资源、编译输出、依赖安装目录；桌面打包资源归入 `desktop/build-resources` |
| `docs` | Documentation | 项目级和顶层模块 spec / plan 真相源 |

## Reading Rule

- 想理解架构：先读 `docs/SPEC.md`，再读顶层模块目录。
- 想找实现：按上表从模块映射到根目录。
- 想找 eval case：从 `docs/evaluation/SPEC.md` 进入，再看 `eval/` 和 `eval/benchmarks/`。
- 想找运行证据：先看 `docs/observability-evidence/SPEC.md`，再看 `logs`、`data`、`memory`、`output`。

## Non-Module Roots

这些目录不应该被当作额外架构模块：

- `dist`：构建输出。
- `node_modules`：依赖安装目录。
- `assets`：README / 品牌图片资源；桌面打包资源在 `desktop/build-resources`。
- `scripts` / `tools`：开发和运维入口；GitHub workflow 当前已移除。
- `.omc` / `.codex-pet-runs`：本地运行产物或工具产物。
