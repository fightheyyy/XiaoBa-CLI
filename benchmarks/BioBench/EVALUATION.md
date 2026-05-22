# BioBench 评测体系设计

BioBench 是一个基于真实 trace 的生信工程师工作流 benchmark。它不是把历史聊天记录原样 replay 一遍，而是把真实 trace 中暴露出的工作场景、工具链行为、失败模式和可交付物要求，转成可复现、可验证、可回归的工程化评测体系。

## 核心评测问题

BioBench 要回答的问题是：

> 在真实生信工程任务中，当前 XiaoBa runtime 是否能稳定完成任务、生成正确产物、可靠使用工具、控制上下文、处理失败，并保证日志安全？

这和“能不能复现旧 trace”不是一回事。旧 trace 是需求来源和风险样本，最终 benchmark 要评估的是新 runtime 遇到同类任务时是否更可靠、更可观测、更安全。

## Trace 提供的真实信号

当前种子 trace：

- 来源：早期 XiaoBa runtime 产生的 `sessions.zip`。
- 原始 trace：不提交到仓库。
- 规范化产物：`benchmark.json`、`episodes.jsonl`、`cases.jsonl`、`dataset-card.md`、`summary.md` 只在本地生成，默认不提交到公开仓库。
- 时间范围：2026-04-08 到 2026-05-11。
- 规模：40 个 trace 文件，519 个对话 turn，9018 条 runtime event。
- 主场景：远程 Linux 服务器操作、R/Seurat 对象检查、marker 表驱动的 cluster 注释、cell type relabel、FeaturePlot/DotPlot/DimPlot/热图生成、R 脚本编辑、文件产物交付、重复流程沉淀成 skill。
- 历史信号：3915 次 tool call，945 次工具失败，工具成功率 75.86%，100 个 context pressure 信号，40 个平台命令错配信号，4555 个脱敏命中。

这些信号决定 BioBench 不应该只评“最终回复好不好”，而要重点评：

- 长上下文治理
- shell / tool 调用正确性
- 生信脚本和产物正确性
- 失败恢复和 blocked reason
- artifact delivery 可观测性
- 日志和产物脱敏

## 整体架构

BioBench 分四层。

### 1. Trace Ingestion 层

目标是把原始 JSONL 统一成稳定 schema：

```text
session -> interaction -> turn -> assistant step -> tool call/result -> runtime event
```

必须抽取的字段：

- 匿名 source id
- platform
- 时间桶
- case kind
- 用户任务类别
- tool sequence
- artifact reference
- token 统计
- latency / duration
- error / warning label
- redaction label

这一层只做事实归一化和候选 case 发现，不直接判断任务成功。

### 2. Case Construction 层

目标是把 trace 片段转成可复跑 case spec。每个 case 至少包含：

- task prompt：从 trace 归纳出的脱敏用户任务
- initial state：fixture 文件树、模拟服务器状态、历史上下文或 memory 状态
- allowed tools：shell、read/write/edit、send_file、skill、subagent、browser 等
- expected artifacts：脚本、图片、表格、报告、发送文件 manifest
- expected behavior：什么时候继续、什么时候澄清、什么时候 blocked
- verifier config：如何自动检查结果
- privacy policy：哪些字符串禁止进入日志、回复、产物

这里的关键点是：**case spec 是 replay 的事实来源，原始 trace 只保留 provenance 价值。**

### 3. Execution 层

目标是在隔离工作区里跑当前 runtime：

```text
case spec
  -> fixture setup
  -> runtime launch
  -> scripted user turns
  -> tool sandbox / mock server
  -> artifact capture
  -> trace capture
  -> verifier execution
  -> scorecard
```

执行模式分两种：

- deterministic mode：工具返回固定 fixture 输出，用于 CI。
- integration mode：真实本地工具跑安全 fixture 数据，用于发布前验证。

远程服务器类任务不应该依赖真实私有服务器。应该用 mock/fixture 模拟 SSH 输出、目录结构、R 文件内容、预期产物路径。

### 4. Scoring & Regression 层

每次评测运行都要输出：

- `run.json`：runtime 版本、模型配置、环境、时间戳
- `trace.jsonl`：规范化后的运行事件
- `scorecard.json`：各维度分数和 pass/fail
- `artifacts/`：生成产物和 verifier 证据
- `report.md`：人工可读报告

回归评测时，用当前 scorecard 对比 pinned baseline。

## Case 分类体系

BioBench 的 case 要按任务类型和失败模式分层，不能只随机抽样。

### 任务类型

| 类型 | 评测点 | 示例产物 |
| --- | --- | --- |
| `remote_workspace_navigation` | SSH/session 状态、路径切换、目录检查 | 结构化文件清单 |
| `seurat_object_inspection` | R/Rmd/Rds 相关对象检查和摘要 | 对象摘要或检查脚本 |
| `cluster_annotation` | marker 判断、细胞类型命名、输出一致性 | annotation 表格、R 脚本 |
| `plot_generation` | FeaturePlot/DotPlot/DimPlot/热图生成逻辑 | png/pdf 图片 |
| `r_script_editing` | 精准修改已有 R 脚本，不误伤无关代码 | patch 后的 R 文件 |
| `artifact_delivery` | 文件发送和最终确认可观测 | sent artifact manifest |
| `workflow_packaging` | 把重复流程沉淀成 skill/script | reusable workflow 文档或 skill |
| `long_context_recovery` | 压缩后仍保留关键任务状态 | compaction 后正确续作 |
| `failure_recovery` | 超时、限流、平台命令错配后的恢复 | blocked reason 或替代路径 |
| `log_hygiene` | 日志、产物、摘要不泄漏敏感信息 | redaction report |

### 从 trace 看到的失败模式

| 失败模式 | Trace 信号 | 评测要求 |
| --- | --- | --- |
| 平台命令错配 | Windows shell 下使用 Unix 命令 | runtime 能选择 OS-aware 命令，或明确 blocked |
| 上下文压力 | prompt tokens 超过安全预算 | compressor 保留任务状态和最近用户意图 |
| 工具超时 | shell/browser 长时间卡住 | 超时可见、可恢复、不无限等待 |
| 敏感信息落日志 | credentials 出现在 tool args/result/runtime log | 日志和 benchmark artifact 必须脱敏 |
| 产物交付不清楚 | 文件发送了但最终状态不明确 | 记录发送路径、文件名和用户可见确认 |
| browser fallback | 首选 browser 工具不可用 | fallback 路径明确，不静默循环 |
| restore 状态不透明 | session restore 后隐式上下文不清楚 | restore/memory 状态进入可观测 trace |

## 打分模型

BioBench 分两级打分：case score 和 suite score。

### Case Score

每个 replay case 100 分。

| 维度 | 权重 | 自动 verifier |
| --- | ---: | --- |
| 任务完成度 | 35 | 预期文件存在、内容断言通过 |
| 领域正确性 | 20 | R/Seurat 脚本结构、marker/celltype 映射、绘图语义 |
| 工具可靠性 | 15 | 工具调用成功、重试有边界、无孤儿 tool transcript |
| 上下文处理 | 10 | 长上下文和 restore 后关键事实仍存在 |
| 产物交付 | 8 | 输出 manifest、文件路径、最终确认 |
| 安全与隐私 | 7 | 日志、回复、产物无 forbidden strings |
| 效率 | 5 | token、工具次数、耗时在预算内 |

硬失败条件：

- 必需产物缺失
- 日志或产物出现敏感信息
- runtime crash 或超过 timeout
- assistant 声称完成但没有 verifier evidence
- provider 可见 tool transcript 非法

### Suite Score

整体分数可以这样聚合：

```text
suite_score =
  0.45 * average_task_success
  + 0.20 * average_domain_correctness
  + 0.15 * average_reliability
  + 0.10 * average_context_score
  + 0.10 * average_safety_score
```

当前 README 里的 `69/100` 是 **Trace Quality Score**，不是最终 runtime 能力分。

BioBench 后续应该同时报告两个分：

- Trace Quality Score：历史 trace 是否干净、可解析、信息量足够。
- Runtime Replay Score：当前 runtime 在可复跑生信工程 case 上的真实表现。

### Quality / Efficiency 双轴评估

BioBench 不把所有指标直接混成一个总分。生信工程任务的核心原则是：**质量先过门槛，效率再做排序**。

每个 case 同时输出两条主轴：

- `quality_score`：任务完成度、领域正确性、产物质量、交付可观测性、安全隐私。
- `efficiency_score`：端到端耗时、turn 数、tool call 数、失败重试数、token 成本。

硬门槛先于分数：

- 必需产物缺失，直接 fail。
- R 脚本无法 parse 或明显不可运行，直接 fail。
- 图片、表格、报告没有 verifier evidence，直接 fail。
- 日志、回复或产物泄漏敏感信息，直接 fail。
- runtime crash、timeout、非法 tool transcript，直接 fail。

A/B 评估使用 paired comparison：同一个 case 同时跑 baseline branch 和 candidate branch，逐 case 比较。

```text
case_001:
  baseline: quality=76, efficiency=62, pass=true
  candidate: quality=84, efficiency=48, pass=true
  decision: candidate_wins_quality

case_002:
  baseline: quality=82, efficiency=45, pass=true
  candidate: quality=66, efficiency=88, pass=false
  decision: baseline_wins_quality_gate

case_003:
  baseline: quality=86, efficiency=51, pass=true
  candidate: quality=84, efficiency=79, pass=true
  decision: candidate_wins_efficiency
```

推荐决策规则：

- 如果一方 hard fail，另一方 pass，pass 的一方胜出。
- 如果 `quality_score` 差距 >= 10 分，质量高的一方胜出。
- 如果 `quality_score` 差距 < 5 分，比较 `efficiency_score`、token、tool calls 和耗时。
- 如果双方质量都低于 passing threshold，结论是 both_fail，不用速度掩盖质量问题。
- 如果 candidate 质量小幅下降但效率大幅提升，标记为 tradeoff，需要人工或 release owner 接受。

Suite 层不要只报告单个总分，而要报告：

- `pass_rate_delta`
- `quality_win_rate`
- `efficiency_win_rate`
- `hard_failure_delta`
- `artifact_success_delta`
- `token_delta`
- `latency_delta`
- `tool_call_delta`
- `regression_cases`

## Branch / Lane 评测策略

不同 branch 的改动目标不同，CI 不应该永远跑同一套重评。BioBench 可以分成几条 lane，每条 lane 有自己的重点指标和门禁。

| Lane | 适用 branch | 重点 case | 必看指标 | 门禁 |
| --- | --- | --- | --- | --- |
| `runtime_lane` | runtime、tool protocol、context、retry | long_context、failure_recovery、artifact_delivery、runtime_restore | crash、timeout、tool transcript、retry、token、latency | hard fail 不增加，context case 不退化 |
| `skill_lane` | bio skill、prompt、R workflow | plot_generation、cluster_annotation、r_script_editing、seurat_object_inspection | 领域正确性、R parse、产物内容、artifact evidence | quality_score 不下降，必需产物全通过 |
| `logger_lane` | logger、trace schema、harness | log_hygiene、artifact_delivery、all cases smoke | JSONL parse、redaction、artifact_manifest、error_code、skill_id | parse coverage 100%，privacy 100% |
| `efficiency_lane` | model、context compressor、tool routing | 高 token、高 tool call、慢工具 case | token、turns、tool calls、latency、失败重试 | 质量不显著下降，效率目标达成 |
| `release_lane` | release/main 合并前 | 全量 selected cases | pass rate、quality、efficiency、safety、regression diff | release gate 全通过 |

### BioBench 工业化运行分层

日常开发不需要每次都跑最重的集成评测，可以按成本分层：

| 层级 | 触发时机 | 内容 | 目标耗时 |
| --- | --- | --- | ---: |
| `ingest_smoke` | 每次 PR | trace/case schema、redaction、metadata、selected case manifest | < 1 min |
| `deterministic_replay` | runtime/skill 相关 PR | mock fixture + scripted turns + verifier | 5-15 min |
| `integration_replay` | release 前或 nightly | tiny synthetic R fixture、真实本地工具、artifact verifier | 20-60 min |
| `manual_review_pack` | 重要模型/skill 变更 | 抽样报告、失败 case、产物截图、R diff | 人工确认 |

## Verifier 设计

Verifier 尽量 deterministic，少依赖 LLM judge。

### 文件和产物 verifier

示例断言：

```text
assert file exists: output/featureplot_Ms4a1_Cd79a.png
assert file exists: scripts/annot_celltype.R
assert file size > 0
assert artifact manifest contains sent file path
```

图片产物轻量检查：

- 文件存在
- 图片可解码
- 宽高在预期范围
- 不是空白图或近似纯色图

### R 脚本 verifier

CI 不应该强依赖完整 Seurat 数据，所以先做静态检查：

- R 可用时脚本能 parse
- 包含必要 `library` 或 guarded import
- 包含预期 Seurat 操作：`ReadRDS`、`DefaultAssay`、`FeaturePlot`、`DotPlot`、`DimPlot`、`ggsave`
- 输出路径符合 case spec
- 不硬编码私有凭据、本机路径或真实服务器信息

可选 integration verifier：

- 用 tiny synthetic fixture object 或 mock R output 跑一遍
- 检查输出文件和运行日志

### 领域 verifier

cluster annotation / marker review 类任务：

- 预期 cell type 名称出现
- relabel 命名风格符合用户要求
- marker list 包含必要基因
- 指定顺序稳定
- 不凭空发明 cluster id

确定性内容用脚本断言；解释性文字才用人工 rubric 或 LLM judge 辅助。

### Runtime verifier

检查 runtime 本身：

- 无非法 assistant/tool transcript 顺序
- 无 dangling tool call
- 无静默空回复
- retry loop 有上限
- blocked 状态包含原因和下一步
- restore / compaction 事件进入 trace
- 敏感值在持久化前脱敏

## 工程流程

### 新增真实 trace

1. 原始 trace 放在 repo 外。
2. 运行 ingestion：

```bash
npm run benchmark:legacy-trace -- /path/to/sessions.zip \
  --out /tmp/<BenchmarkName> \
  --topic "<BenchmarkName>" \
  --source-note "不包含私有路径的来源说明" \
  --theme "工作负载说明"
```

3. 本地 review `README.md`、`summary.md`、`episodes.jsonl`、`cases.jsonl`、`dataset-card.md`。
4. 只有通过隐私审查并 fixture 化的 case spec 才能提交到公开仓库。
5. 在未来的 `cases/` 目录补 fixture replay case。
6. 为新增任务类型补 verifier。
7. 提交前跑 redaction scan。

### 回归运行

目标命令形态：

```bash
npm run benchmark:legacy-trace -- /path/to/sessions.zip --out /tmp/biobench-local
npm run biobench:replay -- benchmarks/BioBench
npm run biobench:report -- benchmarks/BioBench/runs/<run-id>
```

第一个命令已经有了。`replay` 和 `report` 是下一层工程化能力。

### CI 门禁

建议 CI gate：

- ingestion parse coverage 必须 100%
- replay pass rate 相比 baseline 不能下降超过 3 个百分点
- safety/privacy score 必须 100%
- 不允许新增 hard-fail case，除非显式接受
- 平均 tool failures per case 不能上升超过 10%
- context-pressure case 必须低于 provider 预算
- 每个生成 artifact 必须有 verifier evidence

## ReviewerCat Release Gate 职责

BioBench 是 benchmark 资产，不放在 `roles/reviewer-cat/` 下维护独立专题 spec。ReviewerCat 在 BioBench 中承担 release gate owner 角色：

- Case Curator：从真实 trace 中挑选高价值生信工作流，去重、脱敏、归类。
- Fixture Builder：把 trace-derived case 升级为可运行 fixture、expected artifacts 和 assertions。
- Oracle Designer：为 role 行为、生信领域结果和 runtime 稳定性定义 verifier。
- E2E Runner：按 `benchmarks/SPEC.md` 的 replay lane 策略运行目标 role。
- Evidence Judge：检查 transcript、tool trace、stdout/stderr、文件产物、日志脱敏和领域结果。
- Release Gate Owner：根据 scorecard 阈值判定 `pass / fail / blocked`，不让证据不足的版本上线。

成熟 BioBench 应从 `trace-derived workload catalog` 升级为：

```text
real trace source
  -> redacted runnable cases
  -> fixture / expected / assertions
  -> replay / e2e run
  -> role oracle + domain oracle + runtime oracle
  -> scorecard
  -> release gate
```

## Scorecard Schema

每次 replay run 产出类似：

```json
{
  "benchmark": "BioBench",
  "runId": "2026-05-15T10-00-00Z",
  "runtimeVersion": "git-sha",
  "model": "model-name",
  "summary": {
    "suiteScore": 0,
    "passRate": 0,
    "qualityWinRate": 0,
    "efficiencyWinRate": 0,
    "passRateDelta": 0,
    "tokenDelta": 0,
    "latencyDelta": 0,
    "hardFailures": 0,
    "privacyFailures": 0,
    "artifactFailures": 0
  },
  "cases": [
    {
      "id": "case-id",
      "type": "plot_generation",
      "score": 0,
      "qualityScore": 0,
      "efficiencyScore": 0,
      "status": "pass|fail|blocked",
      "abDecision": "candidate_wins_quality|candidate_wins_efficiency|baseline_wins|both_fail|manual_tradeoff",
      "dimensions": {
        "taskSuccess": 0,
        "domainCorrectness": 0,
        "toolReliability": 0,
        "contextHandling": 0,
        "artifactDelivery": 0,
        "safetyPrivacy": 0,
        "efficiency": 0
      },
      "metrics": {
        "turns": 0,
        "toolCalls": 0,
        "failedToolCalls": 0,
        "promptTokens": 0,
        "completionTokens": 0,
        "latencyMs": 0
      },
      "evidence": [
        "artifacts/path",
        "verifier-output/path"
      ],
      "failureReasons": []
    }
  ]
}
```

## 面试回答模板

如果面试官问“拿到 trace 后怎么设计评测”，可以这样答：

> 我不会直接把原始 trace 当 benchmark。第一步是 normalize 和 redact，把 trace 统一成 session、turn、tool call、runtime event、artifact、token、latency、error label 的结构化数据。第二步是从 trace 里提取真实 workflow taxonomy 和 failure taxonomy。第三步把代表性 trace 片段转成 replayable case spec：包括 fixture 初始状态、用户任务、allowed tools、expected artifacts、verifier、隐私规则。第四步用多维 scorecard 评估：task success、domain correctness、tool reliability、context handling、artifact delivery、safety/privacy、efficiency。最后把 scorecard 接到 CI regression gate，和 pinned baseline 比较，防止新版本退化。

套到 BioBench：

> 这批 trace 体现的是生信工程师工作流，所以我会围绕远程服务器操作、R/Seurat 脚本编辑、cluster annotation、绘图出图、artifact delivery、长上下文恢复、平台命令错配恢复、日志脱敏来建 case。复现只是执行方式，真正的评估是 verifier-backed scorecard 和 regression gate。
