# BioBench 领域特化 SPEC

本文是 BioBench 的领域特化规范。通用 trace-to-benchmark 工程规范见 [`../SPEC.md`](../SPEC.md)。

BioBench 继承根目录规范的核心原则：

> 按 session 接入 trace，按 episode 切任务，按 case 做评测，按 metadata 路由优化 runtime 或 skill。

本文只补充生信工程师工作流里的任务类型、领域信号、日志字段缺口和实现路线。

## 1. 层级模型

BioBench 使用四层颗粒度：

```text
Session -> Episode -> Turn -> Tool Call
```

### Session

Session 是日志/系统会话边界，来自 runtime 或 IM 平台。

典型来源：

- 一个 session_id
- 一个 JSONL 文件
- 一次用户和 XiaoBa 的连续会话
- 一次 restore / TTL 管理的上下文
- 一个 IM channel 或 user/group chat

Session 是接入和恢复边界，不是评测边界。一个 session 里可能包含多个真实任务。

### Episode

Episode 是任务边界。它是从 session 中抽取出来的一段围绕同一目标展开的多轮交互。

一个 episode 应该能回答：

- 用户要完成什么任务？
- 初始上下文和文件状态是什么？
- 经过了几个 turn？
- 用了哪些 tool / skill？
- 生成了哪些 artifact？
- 出现了哪些 failure mode？
- 这个任务应该如何验证？

BioBench 约定：

```text
1 episode -> 1 benchmark case
```

更精确地说：

```text
episode 是 trace 中的原始任务单元
case 是 episode 清洗、脱敏、补 fixture、补 verifier 后的评测用例
```

### Turn

Turn 是单轮用户-助手交互。

一个 turn 通常包含：

- user input
- assistant output
- 0 个或多个 tool call
- tool results
- token usage
- errors / warnings
- artifacts

注意：

```text
turn != tool call
```

一个 turn 可以没有 tool call，也可以包含多个 tool call。

### Tool Call

Tool Call 是 turn 内部的执行动作。

需要记录：

- tool name
- redacted args
- result summary
- success / failure
- duration
- error code
- artifact references

## 2. 数据流

完整数据流如下：

```text
raw trace
  -> session-level ingestion
  -> normalized turns/runtime events
  -> episode extraction
  -> case metadata generation
  -> fixture/replay case construction
  -> verifier execution
  -> scorecard
  -> runtime/skill optimization routing
```

当前仓库已经实现到：

```text
raw trace
  -> session-level ingestion
  -> normalized turns/runtime events
  -> trace profile
  -> episode extraction
  -> case metadata generation
  -> runtime/skill/hybrid routing
  -> dataset card
```

尚未完整实现：

```text
fixture replay
verifier runner
scorecard regression
CI regression gate
```

## 3. Episode Extraction 规范

Episode extraction 的输入是按时间排序的 session turns。

### Episode 边界信号

建议用以下信号切 episode：

- 新任务目标出现：例如“进入另一个路径”、“重新画图”、“打包成 skill”
- 工作目录或项目路径切换
- 分析对象切换：例如从 Neu 到 Mac，从一个 Rds 到另一个 Rds
- 产物生成或发送完成
- 用户确认/纠错后进入新目标
- 长时间间隔或跨天
- session restore 后开始新任务
- turn 编号重置

### Episode 输出字段

```json
{
  "episode_id": "biobench.ep.000001",
  "source_session_hash": "hash",
  "source_paths": ["sessions/catscompany/2026-04-08/trace-0001.jsonl"],
  "start_turn": 1,
  "end_turn": 4,
  "turn_count": 4,
  "task_summary": "在远程 Seurat 项目中生成 marker FeaturePlot 并保存图片",
  "task_type": "plot_generation",
  "domain": "bioinformatics",
  "domain_subtype": "single_cell_seurat",
  "tools_used": ["execute_shell", "read_file", "write_file", "send_file"],
  "skills_triggered": ["seurat-plotting"],
  "tool_call_count": 12,
  "successful_tool_calls": 10,
  "failed_tool_calls": 2,
  "tool_success_rate": 0.8333,
  "total_tokens": 17342,
  "prompt_tokens": 16200,
  "completion_tokens": 1142,
  "artifacts_observed": ["output/featureplot.png"],
  "failure_modes_observed": ["tool_timeout"],
  "context_pressure": false,
  "requires_artifact": true,
  "requires_remote_fixture": true
}
```

## 4. Case Metadata 规范

一个 episode 生成一个 benchmark case。Case metadata 是后续分层统计、回归评测和问题路由的核心。

### 必填字段

```json
{
  "case_id": "biobench.case.000001",
  "source_episode_id": "biobench.ep.000001",
  "benchmark": "BioBench",
  "case_category": "runtime_case | skill_case | hybrid_case",
  "task_type": "plot_generation",
  "domain": "bioinformatics",
  "domain_subtype": "single_cell_seurat",
  "turn_count": 4,
  "tool_call_count": 12,
  "successful_tool_calls": 10,
  "failed_tool_calls": 2,
  "tool_success_rate": 0.8333,
  "total_tokens": 17342,
  "prompt_tokens": 16200,
  "completion_tokens": 1142,
  "tools_used": ["read_file", "write_file", "execute_shell", "send_file"],
  "skills_triggered": ["seurat-plotting"],
  "failure_modes_observed": ["tool_timeout"],
  "expected_artifacts": ["output/featureplot.png", "output/featureplot.pdf"],
  "requires_artifact": true,
  "requires_long_context": false,
  "requires_remote_fixture": true,
  "privacy_level": "redacted"
}
```

### 统计用途

这些 metadata 用于：

- 生成 dataset card
- 按 task type 分层抽样
- 按 runtime/skill/hybrid 分类看失败
- 计算每类 case 的 pass rate
- 发现哪些 skill 或 runtime 机制最需要优化
- 做 CI regression gate

## 5. Runtime Case / Skill Case / Hybrid Case

### runtime_case

主要评 XiaoBa runtime 编排能力。

典型评测点：

- context compression
- session restore
- tool transcript 合法性
- tool retry / timeout
- platform command compatibility
- artifact delivery
- log redaction
- wakeup / long task state

判定规则示例：

```text
如果 failure mode 主要来自上下文、日志、工具协议、重试、平台适配、产物发送，则归 runtime_case。
```

### skill_case

主要评某个领域 skill 或工作流能力。

BioBench 中典型 skill 能力：

- Seurat plotting
- cluster annotation
- marker review
- R script editing
- workflow packaging

判定规则示例：

```text
如果成功与否主要取决于领域步骤、prompt、skill 脚本或工作流模板，则归 skill_case。
```

### hybrid_case

同时评 runtime 和 skill。

例如：

- 长上下文下做 Seurat 绘图
- 远程工具超时后继续完成 artifact delivery
- restore 后继续执行 cluster annotation

判定规则示例：

```text
如果 case 同时依赖 runtime 稳定性和 skill 领域正确性，则归 hybrid_case。
```

## 6. 优化路由

评测失败后要能路由到对应优化方向。

| 失败现象 | 优化方向 |
| --- | --- |
| tool transcript 非法、dangling tool call | runtime |
| context 压缩后丢任务目标 | runtime |
| session restore 后状态不清楚 | runtime |
| 失败无 blocked reason | runtime |
| send_file 成功但最终回复没有产物说明 | runtime |
| 日志泄漏凭据或真实路径 | runtime / logger |
| R 脚本缺 FeaturePlot / DotPlot / ggsave | skill |
| cluster annotation 逻辑不对 | skill |
| marker list 不符合要求 | skill |
| workflow packaging 产物不可复用 | skill |
| 长上下文 + skill 领域步骤同时失败 | hybrid，先看 hard failure 属于哪层 |

## 7. 日志系统要求

评测体系和日志系统必须相辅相成。日志 schema 越稳定，trace 清洗越自动化。

当前 XiaoBa runtime 的可清洗 trace 主线是 `logs/sessions/**/*.jsonl`。BioBench 不再消费普通 `.log` 作为评测输入；没有 session context 的 runtime/debug 输出只保留在控制台，不进入 benchmark dataset。

### Current Log Contract

BioBench v0 必须围绕当前 XiaoBa JSONL 日志设计。当前日志能稳定提供的是 session/turn/tool/runtime 的基础事实，而不是完整 replay case。

当前 `SessionTurnLogger` 稳定记录：

- `schema_version`
- `entry_type`
- `turn`
- `timestamp`
- `session_id`
- `session_type`
- `user.text`
- `assistant.text`
- `assistant.tool_calls`
- `tool_calls.id`
- `tool_calls.name`
- `tool_calls.arguments`
- `tool_calls.result`
- `tokens.prompt`
- `tokens.completion`

这些字段足够做基础 trace profile：

- turns
- tool calls
- tool successes/failures
- token usage
- basic issue labels
- 任务类型和 failure taxonomy 的初步归类

当前 logger 也会写入或推断一些辅助字段：

- `turn_id`：logger 生成。
- `runtime.event_id`：logger 生成。
- `tool_calls.tool_call_id`：优先取原始 tool id，缺失时 logger 生成。
- `tool_calls.status`：如果 tool executor 没显式传入，则由 result 文本推断。
- `tool_calls.error_code`：如果 tool executor 没显式传入，则由 result 文本推断。
- `tool_calls.artifact_manifest`：如果 tool executor 没显式传入，则由路径文本启发式推断。
- `tool_calls.skill_id`：字段已支持，但依赖 skill/runtime 显式传入，当前覆盖率不能默认完整。

这些辅助字段可以提升清洗质量，但 BioBench v0 不能把它们当作完全可靠的 ground truth。比如 artifact manifest 能帮助发现“可能生成/发送了文件”，但 replay 里的 `expected_artifacts` 仍要由 case spec 明确定义。

### Benchmark 派生字段

以下内容不应该强行要求当前日志系统直接写出，而是在 benchmark 层生成：

- `episode_id`：当前由 ingestion 离线切分，未来 runtime 可提供 hint。
- `case_id`：由 BioBench catalog 生成。
- `case_category`：由 task type、failure mode、skill/artifact 信号推导。
- `expected_artifacts`：由 fixture/case spec 定义。
- `verifier_id`：由 case spec 绑定。
- `quality_score` / `efficiency_score` / `scorecard`：由 replay + verifier 运行生成。

### 后续日志增强

后续增强日志 schema 的目标是减少 BioBench 清洗阶段的推断，而不是让当前 spec 脱离现有日志系统。

重点是让 runtime、skill runtime 和 tool executor 显式提供：

```json
{
  "episode_id": "optional runtime hint, still validated by ingestion",
  "skill_id": "activated skill name supplied by skill runtime",
  "active_skill_name": "current active skill",
  "artifact_manifest": [
    {
      "path": "redacted/path",
      "type": "png|pdf|r_script|table|report",
      "action": "created|sent|updated"
    }
  ],
  "error_code": "TOOL_TIMEOUT|RATE_LIMIT|PATH_DENIED|PROVIDER_ERROR",
  "runtime_state": {
    "busy": false,
    "restored": true,
    "compacted": false
  },
  "context_budget": {
    "prompt_tokens": 0,
    "budget_tokens": 128000,
    "pressure": false
  },
  "redaction_status": {
    "checked": true,
    "hits": 0
  }
}
```

### 为什么要补日志 schema

如果日志稳定记录 `skill_id`、`artifact_manifest`、`error_code`、`context_budget`，那么后续 episode extraction 可以从规则驱动变成半自动：

```text
skill_id -> skill_case 分类
artifact_manifest -> episode 完成边界
error_code -> failure taxonomy
context_budget -> context pressure case
runtime_state -> restore/compaction case
```

## 8. 当前代码实现状态

### 已实现

| 能力 | 位置 | 状态 |
| --- | --- | --- |
| 读取 zip / 目录 / 单 JSONL | `scripts/legacy-trace-benchmark.ts` | 已实现 |
| 匿名化 trace 文件路径 | `scripts/legacy-trace-benchmark.ts` | 已实现 |
| JSONL parse coverage | `src/harness/legacy-trace-benchmark.ts` | 已实现 |
| turn/runtime entry 识别 | `src/harness/legacy-trace-benchmark.ts` | 已实现 |
| session hash | `src/harness/legacy-trace-benchmark.ts` | 已实现 |
| tool count / success / failure | `src/harness/legacy-trace-benchmark.ts` | 已实现 |
| token / issue / redaction 统计 | `src/harness/legacy-trace-benchmark.ts` | 已实现 |
| episode extraction | `src/harness/legacy-trace-benchmark.ts` | 已实现，基于时间间隔、send_file、任务切换和显式新任务信号切分 |
| `episodes.jsonl` 输出 | `scripts/legacy-trace-benchmark.ts` | 已实现；默认输出到本地目录，不提交 trace-derived artifact |
| episode-level case metadata | `src/harness/legacy-trace-benchmark.ts` | 已实现，包含 turn/tool/success/failure/skill/artifact/context/fixture 字段 |
| runtime/skill/hybrid routing | `src/harness/legacy-trace-benchmark.ts` | 已实现，作为离线 metadata 路由 |
| dataset card | `src/harness/legacy-trace-benchmark.ts` / `scripts/legacy-trace-benchmark.ts` | 已实现；默认输出到本地目录，不提交 trace-derived artifact |
| episode-level case 抽样 | `src/harness/legacy-trace-benchmark.ts` | 已实现，`--max-cases` 控制代表性 case pack 大小 |
| BioBench catalog artifact | 本地输出目录 | 已实现；公开仓库仅保留 spec / evaluation 等已审查文档 |

### 未实现

| 缺口 | 影响 | 建议模块 |
| --- | --- | --- |
| runtime 原生 episode_id | 现在 episode_id 是离线后处理生成，不是 runtime 写入 | `SessionTurnLogger` |
| skill activation 完整结构化 | `tool_calls.skill_id` 字段已支持，但当前主要依赖 skill/runtime 是否显式传入；旧 trace 和部分新 trace 仍要从文本推断 | logger + skill runtime |
| artifact manifest 完整结构化 | `tool_calls.artifact_manifest` 字段已支持；当前若 tool executor 未显式传入，则由路径文本和 tool name 推断，不能当作强真值 | logger + tool executor |
| replay fixture | 还不能把 case 放到隔离环境复跑 | `benchmarks/BioBench/cases/*` |
| verifier runner | 还不能自动验 R 脚本、图片、产物和日志 | `src/harness/verifiers/*` |
| scorecard | 还没有 case/suite 维度分和 regression gate | `src/harness/scorecard.ts` |
| CI 命令 | 还没有 `biobench:replay` / `biobench:report` | package scripts |
| 日志 schema 增强 | 现有日志已有基础 turn/tool/runtime 和部分推断字段；缺口是让 tool executor / skill runtime 显式提供更可靠的 `skill_id`、`status`、`error_code`、`artifact_manifest`、context/runtime state | `SessionTurnLogger`、tool executor、skill runtime |

## 9. 建议实现顺序

### Phase 1: Episode Dataset（已实现）

目标：把现在的 turn-level candidate cases 升级成 episode-level cases。

已完成：

1. 实现 `EpisodeExtractor`。
2. 输出 `episodes.jsonl`。
3. 统计 dataset card：
   - sessions
   - episodes
   - turns
   - tool calls
   - successful / failed tool calls
   - total / prompt / completion tokens
   - avg/p50/p90 turns per episode
   - avg/p50/p90/max tokens per episode
   - task type distribution
   - failure mode distribution
4. 生成 episode-level case metadata。

### Phase 2: Case Routing（已实现离线版本）

目标：把 case 分成 runtime_case / skill_case / hybrid_case。

已完成：

1. 解析 `skills_triggered`。
2. 根据 issue/failure/task/tool signals 分类。
3. 输出每类 case 的统计。
4. 在 report 中给出优化建议。

注意：当前 routing 是离线归因，用于 benchmark 清洗和优化方向判断；真正执行后的失败归因还要等 replay/verifier runner。

### Phase 3: Replay Case（未实现）

目标：从 episode 生成可复跑 case。

要做：

1. 设计 `case.json` schema。
2. 为 BioBench 建 fixture：
   - mock server tree
   - marker table
   - mock Seurat metadata
   - expected scripts/artifacts
3. 实现 `biobench:replay`。

### Phase 4: Verifier + Scorecard

目标：让 CI 能判断变好还是退化。

要做：

1. 文件/图片 verifier。
2. R script static verifier。
3. runtime trace verifier。
4. privacy verifier。
5. scorecard 聚合。
6. CI regression gate。

### Phase 5: Logging Feedback Loop

目标：让日志系统反哺评测。

要做：

1. `SessionTurnLogger` 增加结构化字段。
2. tool executor 写入 error_code 和 artifact manifest。
3. skill activation 写入 skill_id。
4. context compressor 写入 context_budget / compaction event。
5. 用新日志格式降低 episode extraction 难度。

## 10. 总结

BioBench 的工程化闭环是：

```text
structured runtime log
  -> trace ingestion
  -> episode extraction
  -> case metadata
  -> runtime/skill/hybrid routing
  -> fixture replay
  -> verifier scorecard
  -> runtime or skill optimization
  -> better structured runtime log
```

一句话：

> Episode 是可复用的任务级 trace，Case 是可执行的评测用例；case metadata 记录 turn、tool call、成功率、失败率、skill、artifact 和 failure mode，用来区分 runtime case 与 skill case，并把评测结果路由到对应优化方向。
