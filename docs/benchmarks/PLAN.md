# Evaluation Gates PLAN

状态：Active
最后更新：2026-05-30
Owner：Evaluation maintainers

本文维护 XiaoBa 评测回归层的工程推进计划。`SPEC.md` 定义 `benchmarks/`、`tests/`、replay、verifier、scorecard 和 release gate 的架构与 contract；本文定义优先级、owner、验收条件和当前状态。

当前主线：

```text
Contract smoke first, trace catalog second, replay benchmark next.
```

BioBench 是第一个落地对象。

## Plan 和 Spec 的关系

| 文档 | 作用 |
| --- | --- |
| [`SPEC.md`](SPEC.md) | 通用架构、数据层级、日志 contract、case metadata、replay/eval 模型 |
| [`benchmarks/BioBench/SPEC.md`](../../benchmarks/BioBench/SPEC.md) | 生信 trace 的领域 taxonomy、清洗状态和实现差距 |
| [`benchmarks/BioBench/EVALUATION.md`](../../benchmarks/BioBench/EVALUATION.md) | BioBench 的质量/效率评分、A/B、branch lane 和 verifier 设计 |
| `PLAN.md` | 把上述 spec 拆成可执行工程任务，并维护状态 |

## 当前状态

| 层级 | 状态 | 说明 |
| --- | --- | --- |
| Trace catalog | Done local-only | `sessions.zip` 可清洗成 BioBench v0；trace-derived artifacts 默认不提交 |
| Requirement-driven cases | Not started | 已进入 `SPEC.md` 架构；还没有标准 case 文件布局和验收模板 |
| Contract / invariant cases | Not started | 已进入 `SPEC.md` 架构；优先补 transcript、redaction、JSONL schema、timeout、artifact evidence |
| Episode dataset | Done local-only | harness 可生成 `episodes.jsonl`；公开仓库只保留规范和评测方案 |
| Case mining | Done local-only | harness 可生成 selected cases；进入仓库前必须做隐私审查和 fixture 化 |
| Case routing | Done v0 | 已有 `runtime_case` / `skill_case` / `hybrid_case` |
| Replay case spec | Not started | 还没有 `benchmarks/BioBench/cases/*/case.json` |
| AgentSession replay | Not started | 还没有白盒 replay runner |
| E2E replay subset | Partial | ReviewerCat 已有通用 `reviewer_xiaoba_cli_e2e`，尚未接 BioBench case |
| Verifiers | Not started | 还没有 BioBench artifact / R script / privacy / runtime verifier runner |
| Scorecard | Not started | 还没有 `scorecard.json` 聚合和 baseline diff |
| CI gate | Not started | 还没有 `biobench:replay` / `biobench:report` |
| Log feedback | Partial | JSONL 主线已统一；部分字段仍由 logger 推断 |
| Spec / Plan governance | Done | `benchmarks/SPEC.md` 已补齐 Current Architecture 和 Target Architecture Mermaid |

## Milestones

### M0. Catalog Hygiene

目标：保证 trace catalog 可重复生成、可读、可审查。

状态：Done v0。

Owner：InspectorCat / harness。

验收条件：

- `sessions.zip` 可生成 `benchmark.json`、`episodes.jsonl`、`cases.jsonl`、`dataset-card.md`、`summary.md`。
- 输出不包含原始私密路径、credential、真实用户 id。
- `logs/YYYY-MM-DD/*.log` 不再作为 runtime trace 主线。
- `logs/sessions/**/*.jsonl` 是唯一 session trace 输入主线。

后续改进：

- 把 `runtimeEventCount > 0` 这类弱 selection signal 改成 `runtime_issue_signal`。
- 把 `requiresArtifact` 重命名或拆分为 `has_artifact_signal` / `requires_delivered_artifact`。

### M1. Case Selection v1

目标：把当前粗粒度 `scoreEpisodeCase()` 升级成更可解释的 case mining score。

Owner：InspectorCat / harness。

Spec reference：

- [`SPEC.md`](SPEC.md) 的 “模块 2：Episode 到 Case”
- [`benchmarks/BioBench/SPEC.md`](../../benchmarks/BioBench/SPEC.md) 的 “当前代码实现状态”

任务：

- 定义 `case_mining_score` 分项：
  - complexity：turns、tool calls、tokens
  - failure：timeout、tool failure、context pressure、platform mismatch
  - artifact：script、image、table、send_file
  - domain：plot、annotation、script editing
  - replayability：fixture/verifier 是否可构造
  - diversity：category/kind/source 覆盖约束
- 在 `cases.jsonl` 里输出 score breakdown。
- 保留 `runtime_case` / `skill_case` / `hybrid_case`，不要硬二分。

验收条件：

- 每个 selected case 能解释为什么被选中。
- selected cases 继续覆盖 runtime / skill / hybrid。
- 高失败、高产物、高上下文压力 case 不会被普通长对话挤掉。

### M2. Replay Case Spec

目标：把 selected case 从 metadata 升级为可复跑 case。

Owner：ReviewerCat / harness。

Spec reference：

- [`SPEC.md`](SPEC.md) 的 “模块 3：Replay 与验收”
- [`benchmarks/BioBench/EVALUATION.md`](../../benchmarks/BioBench/EVALUATION.md) 的 “Verifier 设计”

任务：

- 创建 `benchmarks/BioBench/cases/<case-id>/case.json` schema。
- 每个 case 至少包含：
  - task prompt
  - target role
  - replay modes
  - fixture path
  - expected artifacts / behavior
  - verifier ids
  - budgets
- 先挑 3 个最小可复跑 case：
  - `plot_generation`
  - `r_script_editing`
  - `artifact_delivery`

验收条件：

- 3 个 case 可以在干净 workspace 独立 setup。
- case spec 不依赖真实私有服务器或真实用户路径。
- case spec 能被 runner 机器读取。

### M3. AgentSession Replay Runner

目标：实现高频、便宜、稳定的白盒 replay。

Owner：ReviewerCat / harness。

Spec reference：

- [`SPEC.md`](SPEC.md) 的 “Replay lane 策略”
- `AgentSession` in `src/core/agent-session.ts`

任务：

- 实现 `AgentSessionReplayRunner`。
- 支持：
  - fixture setup
  - target role activation
  - scripted user turns
  - mock channel callbacks
  - session JSONL capture
  - artifact capture
- 增加 package script：
  - `biobench:replay`

验收条件：

- 能跑 M2 的 3 个 case。
- 每个 run 输出 `runs/<run-id>/manifest.json`、`trace.jsonl`、`report.md`。
- 失败时能给出 case id、失败阶段、失败证据路径。

### M4. Verifier Runner

目标：让 replay 结果可机器判定。

Owner：ReviewerCat。

任务：

- 实现 verifier runner。
- 第一批 verifier：
  - `privacy_scan`
  - `artifact_manifest`
  - `file_exists`
  - `image_decode`
  - `r_script_static`
  - `runtime_trace`
- 每个 verifier 输出结构化 result：
  - pass/fail/blocked
  - evidence paths
  - failure reasons

验收条件：

- 每个 replay case 至少绑定一个 verifier。
- artifact case 必须有 artifact evidence。
- privacy failure 是 hard fail。

### M5. Scorecard and A/B

目标：把 verifier 结果聚合成可回归的质量/效率分。

Owner：ReviewerCat。

Spec reference：

- [`benchmarks/BioBench/EVALUATION.md`](../../benchmarks/BioBench/EVALUATION.md) 的 “Quality / Efficiency 双轴评估”

任务：

- 实现 `scorecard.json`。
- 输出：
  - `quality_score`
  - `efficiency_score`
  - hard failures
  - token/tool/latency metrics
  - baseline diff
  - A/B decision
- 增加 package script：
  - `biobench:report`

验收条件：

- 同一个 case 可以比较 baseline 和 candidate。
- hard fail 不能被效率分抵消。
- scorecard 能被 CI 或 ReviewerCat 直接消费。

### M6. E2E Replay Subset

目标：覆盖真实入口、role 激活、session、channel 和文件交付。

Owner：ReviewerCat。

任务：

- 复用或扩展 `reviewer_xiaoba_cli_e2e`。
- 把 BioBench 中少量 `artifact_delivery` / role activation case 接入 E2E。
- 支持 selected subset，不要求全量 E2E。

验收条件：

- 真实 CLI 入口可以启动目标 role。
- session JSONL 真实落盘。
- artifact delivery case 能证明 `send_file` 或等价交付路径。

### M7. CI Gate

目标：把 replay 接入持续回归。

Owner：ReviewerCat / release owner。

任务：

- 定义 PR / nightly / release 三层 gate。
- PR 默认跑 ingest + selected AgentSession replay。
- release 跑 selected suite + E2E subset。

验收条件：

- CI 能输出 scorecard path。
- regression threshold 明确。
- ReviewerCat 可以根据 scorecard 判定 pass / fail / blocked。

### M8. Log Feedback Loop

目标：让未来 trace 更容易清洗，减少离线推断。

Owner：EngineerCat / runtime。

任务：

- tool executor 显式传入：
  - `status`
  - `error_code`
  - `artifact_manifest`
- skill runtime 显式传入：
  - `skill_id`
  - active skill state
- context compressor 写入：
  - context budget
  - compaction event
- 评估是否需要 runtime-level episode hint。

验收条件：

- ingestion 代码对文本启发式依赖下降。
- artifact delivery 可以区分 created / updated / sent。
- runtime issue signal 比 `runtimeEventCount > 0` 更有区分度。

## 当前推荐执行顺序

1. M1：先修 case mining score，让 selected cases 更可信。
2. M2：补 3 个最小 replay case spec。
3. M3：实现 AgentSession replay。
4. M4：补最小 verifier runner。
5. M5：输出 scorecard。
6. M6：挑 artifact delivery 做 E2E subset。
7. M7：接 CI gate。
8. M8：把 replay 中发现的日志缺口反哺 runtime。

## 状态维护规则

- spec 变更如果新增字段、阶段或职责，必须同步更新本 plan。
- plan 中某个 milestone 完成后，必须回写对应 spec 的 “当前状态”。
- `BioBench` 的领域细节放在 `benchmarks/BioBench/SPEC.md` 和 `benchmarks/BioBench/EVALUATION.md`；通用执行计划放在本文。
- 不把 trace catalog 包装成完整 replay benchmark；只有 M2-M5 完成后，才称为 runnable benchmark。
