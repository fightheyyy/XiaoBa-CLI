# XiaoBa Case Replay 与反馈闭环 Spec

状态：Draft  
目标版本：v1  
适用仓库：XiaoBa-CLI，后续可与 XiaoBa-AutoDev 联动  
最后更新：2026-05-07

## 1. 背景

XiaoBa-CLI 已经具备 agent harness 的关键底座：统一 runtime、多入口接入、roles / skills / tools 分层、session JSONL、runtime log、Inspector / Engineer / Reviewer worker，以及 AutoDev case 流转。

当前最需要补齐的不是更多 prompt，而是一个可工程化演进的测试与反馈闭环：

```text
真实运行
  -> 捕获失败
  -> 生成可复现 case
  -> replay 重放
  -> evaluator 判定
  -> EngineerCat 修复
  -> ReviewerCat 验证
  -> 回写 runtime / skill / prompt / docs
  -> case 关闭或重开
```

本 spec 定义四个阶段：

1. Case Store：每个失败都有 ID、类型、session、复现输入、期望结果、状态。
2. Replay Runner：能重放一个 case，先支持 mock / recorded replay，再支持 live model replay。
3. Evaluator：先用规则判断，后面再接 ReviewerCat / LLM judge。
4. EngineerCat 自动修复：只有在 case 可复现、可判定后才进入自动修复。

## 2. 当前单测成熟度判断

结论：XiaoBa-CLI 的单测和集成测试已经覆盖了不少 runtime 关键模块，并且已补上 tool adapter / skill activation / runner skill injection / session skill path 的关键空洞；但还不能说“反馈闭环测试已经完备”。

已有覆盖较好的方向：

- Inspector 本地 case store / worker / runtime support。
- EngineerCat / ReviewerCat AutoDev worker 的部分流转。
- provider 兼容性与 Anthropic 特定 bug。
- rate limit / failover 相关路径。
- tool manager、grep tool、context compressor、roles、logger、pet channel 等基础模块。
- AgentToolExecutor 的工具定义、别名、上下文合并、错误包装和 `pause_turn` 控制信号。
- SkillParser / SkillExecutor / skill activation protocol 的核心单测。
- ConversationRunner 通过 `skill` 工具动态注入 system prompt，并在下一轮模型请求中生效。
- AgentSession 自动激活 skill 后进入主 runner 请求的集成路径。

当前测试基线：

```text
npm test
117 tests, 117 pass

npm run build
pass
```

仍然缺口明显的方向：

- 缺少统一的 CaseRecord 数据契约，现有 InspectorCaseStore 更偏日志上传和分析任务，不是完整 regression case store。
- 缺少 session replay runner，不能把真实失败稳定重放成回归测试。
- 缺少 evaluator assertion schema，无法用机器判断“这次 replay 是否修好”。
- 缺少 tool call recorded replay，模型重跑时容易因为 live tool / live model 不确定性导致不可复现。
- 缺少 case -> EngineerCat -> patch -> replay -> ReviewerCat 的本地最小闭环。
- 缺少 replay case 的 CI 分层策略，例如 PR smoke、nightly live replay、手动大样本回归。

因此现状更像是：

```text
单元测试底座：较好，关键 harness 模块已开始成体系覆盖
集成测试底座：中等偏好，已有 runtime/worker/skill 主链路覆盖
反馈闭环测试：有雏形，但缺 case 化、replay 化、判定化
```

本 spec 的目标就是把这部分补齐。

### 2.1 已补齐的前两层测试

本轮新增测试不属于反馈闭环 case，而是为后续 case replay 打地基。新增文件：

```text
tests/agent-tool-executor.test.ts
tests/skill-core.test.ts
tests/conversation-runner-skill-activation.test.ts
tests/agent-session-skill-integration.test.ts
```

这些测试的定位：

- `agent-tool-executor.test.ts`：单测。确保子 agent / agent runtime 使用的 tool adapter 在别名、错误、上下文、控制信号上稳定。
- `skill-core.test.ts`：单测。确保 skill 文件解析、占位符展开、activation signal 解析与 system prompt upsert 稳定。
- `conversation-runner-skill-activation.test.ts`：集成测试。验证模型调用 `skill` 工具后，runner 能把 tool result 转成下一轮模型请求可见的 system prompt。
- `agent-session-skill-integration.test.ts`：集成测试。验证用户消息触发自动 skill 激活后，AgentSession 会把 skill prompt 和可用 skills 列表注入主 runner 请求。

这批测试解决的是：

```text
模块正确性
  -> tool adapter / skill parser / skill activation protocol

模块组合正确性
  -> AgentSession -> SkillManager -> ConversationRunner -> AI request
  -> ConversationRunner -> skill tool -> system prompt injection
```

它们没有解决的是：

```text
真实失败 log
  -> case store
  -> replay
  -> evaluator
  -> regression pass/fail
```

因此下一步仍然是实现反馈闭环 case，而不是继续无限补普通单测。

## 3. 设计原则

### 3.1 先让失败可复现，再谈自动修复

EngineerCat 自动改代码之前，必须有可重放的 case 和可判定的结果。否则自动修复会变成“看起来在动”，但系统不知道它是在变好还是变坏。

### 3.2 优先规则判断，再引入 LLM judge

第一版 evaluator 不依赖模型判断。能用确定性规则判断的东西先规则化：

- 是否调用某个 tool。
- 是否不再出现某类 tool error。
- 是否生成某个 artifact。
- 是否进入目标状态。
- 是否返回结构化 JSON。
- 是否包含或不包含关键文本。

LLM judge 只用于更高层的语义质量评估，不能作为 v1 的唯一判定来源。

### 3.3 Case 是一等公民

每个失败都应该能被追踪：

- 为什么生成。
- 来自哪个 session / log。
- 触发信号是什么。
- 如何复现。
- 期望结果是什么。
- 当前状态是什么。
- 谁处理过。
- replay 结果如何。
- 是否已经回写。

### 3.4 Replay 分三档

不要一开始就追求 live model replay。v1 应支持三种模式：

1. `mock`：固定模型输出，用来测 runtime / tool / evaluator。
2. `recorded`：复用历史 tool responses，减少外部环境影响。
3. `live`：真实模型和真实工具重跑，用来做 nightly / 手动验证。

### 3.5 与现有 AutoDev 流转兼容

XiaoBa-CLI 已经有 AutoDev case 状态：

```text
fixing -> reviewing -> closed / reopened
```

新的 Case Store 不应该推翻这条链路，而应该补充前置状态：

```text
captured -> triaged -> replayable -> replay_failed -> fixing
```

## 4. 术语

Case：一条可追踪的问题记录，包含来源、证据、复现方式、期望结果和状态。

Replay：用 case 记录的输入、上下文、模型响应模式和工具响应模式重新执行一次 agent loop。

Evaluator：对 replay 产物做机器判定，输出 pass / fail / inconclusive 和结构化原因。

Artifact：case 相关文件，包括原始 session JSONL、runtime log、replay result、diff、patch、review report、metrics。

Detector：从日志或 session 中识别失败信号的规则。

Fixture：replay 所需的固定输入、mock model 输出、recorded tool 结果。

## 5. 总体架构

```text
logs/sessions/**/*.jsonl
runtime .log
manual report
AutoDev log archive
        |
        v
Failure Detectors
        |
        v
Case Store
        |
        +--> Replay Runner -- replay-result.json --> Evaluator
        |                                           |
        |                                           v
        |                                  evaluation-result.json
        |
        +--> InspectorCat triage
        |
        +--> EngineerCat fix
        |
        +--> ReviewerCat validate + writeback
```

## 6. Case Store

### 6.1 目标

Case Store 负责把失败从“日志里的一段文字”变成“可复现、可判定、可流转”的工程对象。

必须支持：

- 本地文件存储，便于开发和单测。
- 可同步到 AutoDev，便于 dashboard 和多 agent 协作。
- 附件管理。
- 状态流转。
- 事件追加。
- replay / evaluation 结果保存。

### 6.2 本地目录布局

建议新增：

```text
data/cases/
  case-20260507-001-tool-error/
    case.json
    events.jsonl
    source/
      session.jsonl
      runtime.log
    fixtures/
      model-responses.jsonl
      tool-results.jsonl
      filesystem-manifest.json
      env.json
    expected/
      assertions.json
    runs/
      run-20260507-153000/
        replay-input.json
        replay-events.jsonl
        replay-result.json
        evaluation-result.json
        stdout.log
        stderr.log
    artifacts/
      inspector-report.md
      implementation.md
      implementation.patch
      review.md
      case-metrics.json
```

说明：

- `case.json` 是主记录。
- `events.jsonl` 记录状态变化和重要事件。
- `source/` 保存原始证据。
- `fixtures/` 保存 replay 所需固定输入。
- `expected/assertions.json` 保存 evaluator 规则。
- `runs/` 每次 replay 一条，不覆盖历史。
- `artifacts/` 保存 agent 产物。

### 6.3 Case ID

格式：

```text
case-YYYYMMDD-HHMMSS-<category>-<shortHash>
```

示例：

```text
case-20260507-153000-tool-error-a1b2c3
case-20260507-153410-skill-activation-failure-d4e5f6
```

ID 需要稳定、可读、可排序。

### 6.4 CaseRecord v1

建议 TypeScript 契约：

```ts
export type FeedbackCaseStatus =
  | 'captured'
  | 'triaged'
  | 'replayable'
  | 'replaying'
  | 'replay_passed'
  | 'replay_failed'
  | 'fixing'
  | 'reviewing'
  | 'closed'
  | 'reopened'
  | 'blocked'
  | 'ignored';

export type FeedbackCaseCategory =
  | 'runtime_bug'
  | 'tool_error'
  | 'skill_activation_failure'
  | 'skill_fix'
  | 'new_skill_candidate'
  | 'provider_bug'
  | 'context_bug'
  | 'safety_violation'
  | 'quality_regression'
  | 'insufficient_signal';

export interface FeedbackCaseRecordV1 {
  version: 1;
  caseId: string;
  title: string;
  status: FeedbackCaseStatus;
  category: FeedbackCaseCategory;
  priority: 'p0' | 'p1' | 'p2' | 'p3';
  confidence: 'low' | 'medium' | 'high';

  createdAt: string;
  updatedAt: string;
  closedAt?: string;

  source: {
    kind: 'session_jsonl' | 'runtime_log' | 'manual' | 'autodev_log';
    sessionId?: string;
    sessionType?: string;
    logDate?: string;
    logId?: string;
    turnRange?: { start: number; end: number };
    files: Array<{
      path: string;
      kind: 'session_jsonl' | 'runtime_log' | 'screenshot' | 'other';
      sha256?: string;
    }>;
  };

  reproduction: {
    mode: 'mock' | 'recorded' | 'live';
    userInput: string;
    role?: string;
    skillNames?: string[];
    workingDirectory?: string;
    environment?: Record<string, string>;
    model?: {
      provider?: string;
      name?: string;
      temperature?: number;
    };
    toolPolicy?: {
      allowLiveTools: boolean;
      allowedTools?: string[];
      deniedTools?: string[];
      recordedToolResultsPath?: string;
    };
  };

  expected: {
    summary: string;
    assertionsPath: string;
  };

  diagnosis?: {
    rootCauseHypothesis?: string;
    evidence?: string[];
    recommendedNextAction?: string;
  };

  links?: {
    autodevCaseId?: string;
    sourceLogUrl?: string;
    pullRequestUrl?: string;
  };

  labels: string[];
}
```

### 6.5 状态机

主路径：

```text
captured
  -> triaged
  -> replayable
  -> replaying
  -> replay_failed
  -> fixing
  -> reviewing
  -> closed
```

例外路径：

```text
replaying -> replay_passed
replaying -> blocked
triaged -> ignored
reviewing -> reopened -> fixing
fixing -> blocked
```

状态含义：

- `captured`：检测到失败信号，已建 case，但还没有分析。
- `triaged`：InspectorCat 或规则已完成归类。
- `replayable`：复现输入和 assertions 已准备好。
- `replaying`：正在执行 replay。
- `replay_failed`：失败可复现，应进入修复。
- `replay_passed`：当前版本无法复现，可能已被修复或信号不足。
- `fixing`：EngineerCat 正在处理。
- `reviewing`：ReviewerCat 正在验证。
- `closed`：验证通过并完成必要回写。
- `reopened`：验证失败或回归复现。
- `blocked`：缺少信息、权限、环境或人工判断。
- `ignored`：噪声 case，不进入闭环。

### 6.6 与现有 InspectorCaseStore 的关系

现有 `InspectorCaseStore` 已支持：

- 创建本地 case。
- 上传 runtime log / session JSONL。
- 保存分析结果。
- 远端 archive 同步。

但它的状态较偏审查任务：

```text
uploading | received | processing | analyzed | failed
```

建议不要直接把它改成完整反馈 case store。更稳的方式：

1. 保留 `InspectorCaseStore` 作为 Inspector 上传 / 审查入口。
2. 新增 `FeedbackCaseStore`，承载 replay / evaluation / repair 闭环。
3. 提供 adapter：

```text
InspectorCaseRecord -> FeedbackCaseRecordV1
AutoDevCaseDetail   -> FeedbackCaseRecordV1
```

这样避免现有 Inspector 单测和 API 被大改破坏。

## 7. Failure Detectors

### 7.1 目标

Detector 从 session JSONL / runtime log / AutoDev log archive 里抽取失败信号，自动生成 case。

### 7.2 v1 Detector 列表

优先做确定性强的 detector：

| Detector | 触发条件 | 分类 | 默认优先级 |
| --- | --- | --- | --- |
| ToolNotFoundDetector | `TOOL_NOT_FOUND` 或“未找到工具” | `tool_error` | p1 |
| InvalidToolArgsDetector | `INVALID_TOOL_ARGUMENTS` 或 JSON parse error | `tool_error` | p1 |
| ToolExecutionErrorDetector | `TOOL_EXECUTION_ERROR` 或“工具执行错误” | `tool_error` | p2 |
| EmptyFinalAnswerDetector | AI 最终回复为空 | `runtime_bug` | p1 |
| SkillActivationFailureDetector | skill 不存在、激活失败、frontmatter 解析失败 | `skill_activation_failure` | p1 |
| ProviderRateLimitExhaustedDetector | 429 重试耗尽 | `provider_bug` | p2 |
| ContextCompressionFailureDetector | context 压缩失败或超预算 | `context_bug` | p2 |
| UnsafePathDetector | 上传或工具路径被拒绝 | `safety_violation` | p1 |

### 7.3 Detector 输出

```ts
export interface FailureSignal {
  detectorId: string;
  category: FeedbackCaseCategory;
  priority: 'p0' | 'p1' | 'p2' | 'p3';
  confidence: 'low' | 'medium' | 'high';
  title: string;
  summary: string;
  sessionId?: string;
  sessionType?: string;
  turnRange?: { start: number; end: number };
  evidence: string[];
  suggestedAssertions: EvaluationAssertion[];
}
```

### 7.4 去重策略

同类失败容易刷屏，必须去重：

```text
fingerprint = sha256(category + detectorId + normalizedError + toolName + skillName + role)
```

默认策略：

- 24 小时内相同 fingerprint 只创建一个 active case。
- 新证据追加到已有 case 的 `events.jsonl` 和 `source/`。
- 如果已有 case 已 closed，再次出现则创建新 case，并链接 previousCaseId。

## 8. Replay Runner

### 8.1 目标

Replay Runner 接收 caseId，读取 case 的 reproduction 配置，重新执行一次可控的 agent loop，并保存结构化结果。

### 8.2 Replay 模式

#### mock

用途：

- 单测 runtime / tool execution / evaluator。
- 不调用真实模型。
- 不访问真实外部工具。

行为：

- 模型输出来自 `fixtures/model-responses.jsonl`。
- 工具输出可来自 `fixtures/tool-results.jsonl`。
- replay 应该完全确定。

#### recorded

用途：

- 回放真实 session 中已经发生过的 model/tool 序列。
- 验证 runtime 对相同事件是否仍能正确处理。

行为：

- 可以使用历史 assistant tool calls。
- tool 结果默认使用 recorded response。
- 可选择只对部分工具 live，例如只允许 `read_file`。

#### live

用途：

- 验证当前模型和当前 runtime 在真实环境中是否已经修复。
- 适合 nightly 或手动触发，不适合每个 PR 必跑。

行为：

- 调用真实 provider。
- tool 默认仍受 allowlist 限制。
- 必须记录所有输入输出，作为新的 run artifact。

### 8.3 Replay 输入

`replay-input.json`：

```ts
export interface ReplayInputV1 {
  version: 1;
  caseId: string;
  mode: 'mock' | 'recorded' | 'live';
  startedAt: string;
  userInput: string;
  role?: string;
  skills?: string[];
  workingDirectory: string;
  env: Record<string, string>;
  model?: {
    provider?: string;
    name?: string;
  };
  toolPolicy: {
    allowLiveTools: boolean;
    allowedTools: string[];
    deniedTools: string[];
  };
}
```

### 8.4 Replay 事件

`replay-events.jsonl` 每行一个事件：

```ts
export type ReplayEventKind =
  | 'replay_started'
  | 'model_request'
  | 'model_response'
  | 'tool_call_started'
  | 'tool_call_completed'
  | 'tool_call_failed'
  | 'agent_final_response'
  | 'replay_completed'
  | 'replay_failed';
```

### 8.5 Replay 结果

`replay-result.json`：

```ts
export interface ReplayResultV1 {
  version: 1;
  caseId: string;
  runId: string;
  mode: 'mock' | 'recorded' | 'live';
  status: 'completed' | 'failed' | 'timeout' | 'blocked';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  finalResponse?: string;
  toolCalls: Array<{
    id: string;
    name: string;
    argumentsJson?: string;
    ok?: boolean;
    errorCode?: string;
    durationMs?: number;
  }>;
  errors: Array<{
    code: string;
    message: string;
    retryable?: boolean;
  }>;
  artifacts: Array<{
    path: string;
    type: string;
  }>;
}
```

### 8.6 Replay 超时

默认超时：

- mock：30 秒。
- recorded：60 秒。
- live：180 秒。

超时后：

- replay status = `timeout`。
- case status = `blocked` 或保留 `replayable`，由配置决定。
- evaluator 输出 `inconclusive`。

### 8.7 Tool 策略

v1 默认安全策略：

- mock / recorded 模式禁止 live shell。
- live 模式 shell 也必须 allowlist。
- destructive tools 默认禁用。
- 文件写入只允许 case workspace。

建议 allowlist：

```json
{
  "mock": [],
  "recorded": ["read_file", "list_files"],
  "live": ["read_file", "list_files", "grep", "execute_shell_safe"]
}
```

## 9. Evaluator

### 9.1 目标

Evaluator 判断 replay 是否满足 case 的 expected assertions。

输出三个状态：

```text
pass
fail
inconclusive
```

不要只输出自然语言，必须输出结构化原因。

### 9.2 Assertion Schema

`expected/assertions.json`：

```ts
export type EvaluationAssertion =
  | {
      type: 'final_text_contains';
      value: string;
      required?: boolean;
    }
  | {
      type: 'final_text_not_contains';
      value: string;
      required?: boolean;
    }
  | {
      type: 'tool_called';
      toolName: string;
      minCount?: number;
      maxCount?: number;
      required?: boolean;
    }
  | {
      type: 'tool_not_failed';
      toolName?: string;
      errorCode?: string;
      required?: boolean;
    }
  | {
      type: 'no_error_code';
      errorCode: string;
      required?: boolean;
    }
  | {
      type: 'artifact_exists';
      path: string;
      required?: boolean;
    }
  | {
      type: 'json_schema_valid';
      artifactPath: string;
      schemaPath: string;
      required?: boolean;
    }
  | {
      type: 'state_reached';
      state: string;
      required?: boolean;
    }
  | {
      type: 'duration_under_ms';
      value: number;
      required?: boolean;
    };
```

### 9.3 EvaluationResult

`evaluation-result.json`：

```ts
export interface EvaluationResultV1 {
  version: 1;
  caseId: string;
  runId: string;
  status: 'pass' | 'fail' | 'inconclusive';
  score: number;
  evaluatedAt: string;
  summary: string;
  assertionResults: Array<{
    assertion: EvaluationAssertion;
    status: 'pass' | 'fail' | 'skipped';
    message: string;
  }>;
  recommendedNextState:
    | 'replay_passed'
    | 'replay_failed'
    | 'blocked'
    | 'closed'
    | 'reopened';
}
```

### 9.4 判定规则

- 所有 required assertion 通过：`pass`。
- 任一 required assertion 失败：`fail`。
- replay timeout、缺少关键 artifact、case 配置不完整：`inconclusive`。
- score 只用于排序，不替代 pass/fail。

### 9.5 v1 推荐 assertions 模板

#### tool error case

```json
[
  { "type": "tool_called", "toolName": "execute_shell", "minCount": 1, "required": false },
  { "type": "tool_not_failed", "toolName": "execute_shell", "required": true },
  { "type": "no_error_code", "errorCode": "TOOL_EXECUTION_ERROR", "required": true },
  { "type": "final_text_not_contains", "value": "工具执行错误", "required": true }
]
```

#### skill activation failure

```json
[
  { "type": "no_error_code", "errorCode": "SKILL_NOT_FOUND", "required": true },
  { "type": "no_error_code", "errorCode": "INVALID_SKILL_FRONTMATTER", "required": true },
  { "type": "final_text_not_contains", "value": "Skill 不存在", "required": true }
]
```

#### empty final answer

```json
[
  { "type": "final_text_not_contains", "value": "", "required": true },
  { "type": "duration_under_ms", "value": 180000, "required": false }
]
```

注意：空字符串 assertion 在实现时应特殊处理，不能简单用 `includes('')`。

## 10. Agent 闭环分工

### 10.1 InspectorCat

职责：

- 从日志中发现失败信号。
- 创建或更新 case。
- 补充 diagnosis。
- 生成 replay 初始配置。
- 生成 expected assertions 草案。
- 判断 case 是否足够 replayable。

不应该做：

- 直接修改 runtime 代码。
- 在缺少 replay 的情况下把 case 推给 EngineerCat。

### 10.2 Replay Runner

职责：

- 只负责执行和记录。
- 不解释业务原因。
- 不自动修代码。

### 10.3 Evaluator

职责：

- 只负责判定。
- 输出结构化 `evaluation-result.json`。
- 推荐下一状态。

### 10.4 EngineerCat

进入条件：

- case.status = `replay_failed`。
- 至少有一个 required assertion 失败。
- case.category 不等于 `insufficient_signal`。

职责：

- 读取 case、replay result、evaluation result。
- 产出最小修复。
- 产出 implementation artifacts。
- 不负责关闭 case。

输出：

```text
implementation.md
engineer-output.json
implementation.patch
changed-files.txt
```

### 10.5 ReviewerCat

职责：

- 应用或检查 EngineerCat 产物。
- 重新执行 replay。
- 运行相关单测。
- 判定 closed / reopened。
- 生成 writeback plan。

关闭条件：

- replay pass。
- 相关单测 pass。
- patch 风险可接受。
- writeback 完成或明确跳过。

## 11. CLI 设计

建议新增一组命令：

```text
xiaoba case list
xiaoba case show <caseId>
xiaoba case create --from-session <path> --category tool_error
xiaoba case detect --date 2026-05-07 --session-type feishu
xiaoba case replay <caseId> --mode mock
xiaoba case replay <caseId> --mode recorded
xiaoba case replay <caseId> --mode live
xiaoba case evaluate <caseId> --run <runId>
xiaoba case run <caseId> --mode recorded
xiaoba case promote <caseId> --to fixing
```

其中：

- `case replay` 只重放，不判定。
- `case evaluate` 只判定已有 replay result。
- `case run` = replay + evaluate + 状态更新。
- `case detect` 从日志批量生成 case。

## 12. API 设计

如果接入 dashboard，建议提供：

```text
GET    /api/feedback/cases
POST   /api/feedback/cases
GET    /api/feedback/cases/:caseId
POST   /api/feedback/cases/:caseId/events
POST   /api/feedback/cases/:caseId/replay
GET    /api/feedback/cases/:caseId/runs
GET    /api/feedback/cases/:caseId/runs/:runId
POST   /api/feedback/cases/:caseId/evaluate
POST   /api/feedback/cases/:caseId/state
```

Dashboard 首屏应显示：

- active case 数量。
- replay_failed 数量。
- reopened 数量。
- 最近 24h 新增 case。
- case 从 captured 到 closed 的中位耗时。
- top detector / top category。

## 13. CI 分层

### 13.1 PR 必跑

```text
npm test
npm run build
xiaoba case run --suite smoke --mode mock
```

范围：

- 单测。
- TypeScript 编译。
- 少量 mock replay smoke cases。

### 13.2 main 分支合并后

```text
xiaoba case run --suite regression --mode recorded
```

范围：

- 最近 20 个未关闭或高频 closed cases。
- recorded mode，避免外部模型成本和不稳定。

### 13.3 nightly

```text
xiaoba case run --suite nightly --mode live
```

范围：

- 高优先级 closed cases 抽样。
- 最近 reopened cases。
- provider / tool / skill 关键路径。

### 13.4 手动大回归

```text
xiaoba case run --suite all --mode recorded
```

用于 release 前或大重构后。

## 14. MVP 范围

### 14.1 MVP 必做

1. 新增 `FeedbackCaseStore` 本地文件实现。
2. 新增 `ToolExecutionErrorDetector` 和 `SkillActivationFailureDetector`。
3. 支持从 session JSONL 创建 case。
4. 支持 `mock` replay。
5. 支持 evaluator 基础 assertions：
   - `final_text_contains`
   - `final_text_not_contains`
   - `tool_called`
   - `tool_not_failed`
   - `no_error_code`
   - `artifact_exists`
6. 支持 `xiaoba case run <caseId> --mode mock`。
7. 给上述模块补单测。

### 14.2 MVP 不做

- 不做自动应用 patch。
- 不做 live model replay。
- 不做复杂 dashboard。
- 不做 LLM judge。
- 不强依赖 AutoDev server。

## 15. 分阶段实施计划

### Phase 0：契约与测试夹具

新增文件建议：

```text
src/feedback/types.ts
src/feedback/case-store.ts
src/feedback/assertions.ts
tests/feedback-case-store.test.ts
tests/feedback-assertions.test.ts
```

验收：

- 能创建 case。
- 能追加事件。
- 能保存 source / fixture / expected。
- 能列出 active cases。
- 能读写 evaluation assertions。

### Phase 1：Detector

新增文件建议：

```text
src/feedback/detectors/index.ts
src/feedback/detectors/tool-error-detector.ts
src/feedback/detectors/skill-activation-detector.ts
src/feedback/session-log-parser.ts
tests/feedback-detectors.test.ts
```

验收：

- 给定 session JSONL，能生成 FailureSignal。
- 相同失败能去重。
- 能生成 case 草案。

### Phase 2：Mock Replay Runner

新增文件建议：

```text
src/feedback/replay/replay-runner.ts
src/feedback/replay/mock-model-adapter.ts
src/feedback/replay/recorded-tool-executor.ts
tests/feedback-replay-runner.test.ts
```

验收：

- 给定 caseId 和 mock fixtures，能产生 replay-result.json。
- replay 事件完整落盘。
- tool failure 能被稳定复现。

### Phase 3：Evaluator

新增文件建议：

```text
src/feedback/evaluator/evaluator.ts
src/feedback/evaluator/rule-evaluator.ts
tests/feedback-evaluator.test.ts
```

验收：

- 能读取 replay-result.json 和 assertions.json。
- 能输出 evaluation-result.json。
- 能更新 case 状态为 replay_passed / replay_failed / blocked。

### Phase 4：CLI 集成

新增或修改：

```text
src/commands/case.ts
src/index.ts
tests/case-command.test.ts
```

验收：

- `xiaoba case list` 可用。
- `xiaoba case detect` 可用。
- `xiaoba case run <caseId> --mode mock` 可用。

### Phase 5：Engineer / Reviewer 接入

修改：

```text
src/roles/engineer-cat/utils/autodev-engineer-worker.ts
src/roles/reviewer-cat/utils/autodev-reviewer-worker.ts
src/utils/autodev-loop-contract.ts
```

验收：

- EngineerCat 只消费 `replay_failed` 或 AutoDev `fixing` 且带 replay evidence 的 case。
- ReviewerCat 必须执行 replay + evaluator。
- ReviewerCat closed 时附带 evaluation-result.json 和 case-metrics.json。

### Phase 6：Recorded / Live Replay

新增：

```text
src/feedback/replay/live-model-adapter.ts
src/feedback/replay/live-tool-policy.ts
src/feedback/replay/replay-suite.ts
```

验收：

- recorded replay 能复用 tool-results fixture。
- live replay 支持 allowlist。
- nightly suite 可配置。

## 16. 测试策略

### 16.0 Harness 基线测试

反馈闭环 case 不是单测和集成测试的替代品。Case replay 依赖一批稳定的 harness 基线测试，否则 replay 失败时很难判断问题来自 case、runner、evaluator，还是底层 harness 本身。

当前已建立的 harness 基线测试：

| 文件 | 层级 | 保护对象 |
| --- | --- | --- |
| `tests/agent-tool-executor.test.ts` | 单测 | AgentToolExecutor 的工具适配、错误处理、上下文传递 |
| `tests/skill-core.test.ts` | 单测 | SkillParser、SkillExecutor、skill activation protocol |
| `tests/conversation-runner-skill-activation.test.ts` | 集成测试 | ConversationRunner 对 skill tool result 的动态 system prompt 注入 |
| `tests/agent-session-skill-integration.test.ts` | 集成测试 | AgentSession 自动激活 skill 并进入主 runner 请求 |
| `tests/context-compressor.test.ts` | 单测 / 小集成 | 上下文压缩、fallback、工具输出裁剪 |
| `tests/grep-tool.test.ts` | 单测 | grep 工具搜索、分页、fallback、安全路径 |
| `tests/conversation-runner-rate-limit.test.ts` | 单测 / 小集成 | 工具限流重试识别 |
| `tests/autodev-*.test.ts` | 集成测试 | Inspector / Engineer / Reviewer worker 的 AutoDev 流转 |
| `tests/inspector-runtime-support.test.ts` | 集成测试 | Inspector HTTP inbox + case worker |

后续实现 Case Store / Replay Runner / Evaluator 时，这批测试必须继续全量通过。

### 16.1 FeedbackCaseStore 单测

覆盖：

- 创建 case。
- ID 格式。
- 状态流转。
- 事件追加。
- source 文件保存。
- 不安全路径拒绝。
- list / get / update。

### 16.2 Detector 单测

覆盖：

- 每个 detector 的正例。
- 噪声日志不建 case。
- fingerprint 去重。
- turn range 提取。
- suggested assertions 生成。

### 16.3 Replay Runner 单测

覆盖：

- mock model 正常返回。
- mock tool 成功。
- mock tool 失败。
- replay timeout。
- denied tool 被拦截。
- replay-events.jsonl 顺序正确。

### 16.4 Evaluator 单测

覆盖：

- required assertion 全 pass。
- required assertion 任一 fail。
- optional assertion fail 不导致整体 fail。
- inconclusive 场景。
- 空字符串判断。

### 16.5 Worker 集成测试

覆盖：

```text
session JSONL
  -> detector
  -> case store
  -> replay
  -> evaluator
  -> replay_failed
```

第二阶段再覆盖：

```text
replay_failed
  -> EngineerCat fake executor
  -> reviewing
  -> ReviewerCat fake executor
  -> replay pass
  -> closed
```

## 17. 数据脱敏

Case Store 保存真实 session 时必须脱敏：

默认替换：

- API key。
- bearer token。
- cookie。
- webhook。
- database url。
- 用户手机号 / 邮箱可选脱敏。
- 本地绝对路径可配置脱敏。

脱敏记录：

```json
{
  "redacted": true,
  "rules": ["api_key", "bearer_token", "cookie"],
  "redactedAt": "2026-05-07T00:00:00.000Z"
}
```

原则：

- replay 所需的结构保留。
- 秘密信息不落盘。
- 如果脱敏导致不可 replay，case 状态应为 `blocked`，reason 写清楚。

## 18. Metrics

每个 case 需要沉淀指标：

```ts
export interface FeedbackCaseMetricsV1 {
  caseId: string;
  computedAt: string;
  category: FeedbackCaseCategory;
  status: FeedbackCaseStatus;
  replayRunCount: number;
  passCount: number;
  failCount: number;
  reopenedCount: number;
  firstReplayFailedAt?: string;
  firstReplayPassedAt?: string;
  meanReplayDurationMs?: number;
  timeToTriageSeconds?: number;
  timeToReplayableSeconds?: number;
  timeToCloseSeconds?: number;
}
```

Dashboard 和日报里优先看：

- 新增 case 数。
- replay_failed 未处理数。
- reopened 数。
- closed 后再次出现的 detector fingerprint。
- 平均关闭时间。

## 19. 与 OpenAI Harness Engineering 的对应关系

OpenAI 语境里的 harness engineering 重点是：

- 设计 agent 能工作的环境。
- 给 agent 可检查、可执行的结构。
- 建立反馈循环。
- 把失败沉淀成工具、规则、测试、文档。

本 spec 对应关系：

| OpenAI 语境 | XiaoBa 落点 |
| --- | --- |
| agent 工作环境 | runtime、roles、skills、tools |
| feedback loops | case store、replay runner、evaluator |
| agent legibility | case.json、events.jsonl、replay-result.json |
| guardrails | tool policy、assertions、CI suites |
| humans steer | case priority、review decision、writeback policy |
| agents execute | InspectorCat、EngineerCat、ReviewerCat |

## 20. 风险与应对

### 20.1 Live replay 不稳定

应对：

- v1 默认 mock / recorded。
- live 只用于 nightly 和人工触发。
- live 结果不直接作为关闭唯一依据，除非有稳定 assertions。

### 20.2 Case 太多

应对：

- fingerprint 去重。
- priority 分级。
- 噪声 case 自动 ignored。
- dashboard 只突出 active / reopened / p0-p1。

### 20.3 自动修复引入更多问题

应对：

- EngineerCat 只能处理 replay_failed。
- ReviewerCat 必须 replay + tests。
- writeback 默认 manual，等稳定后逐步 auto。

### 20.4 过度依赖 LLM judge

应对：

- v1 不使用 LLM judge 作为核心判定。
- 语义判断只作为辅助 artifact。
- 关闭 case 必须有规则或测试证据。

## 21. Done Definition

MVP 完成标准：

- 至少 3 类失败能自动 case 化。
- 至少 5 个 mock replay cases 可在本地稳定运行。
- `npm test` 覆盖 FeedbackCaseStore / Detector / ReplayRunner / Evaluator。
- `xiaoba case run <caseId> --mode mock` 能生成 replay result 和 evaluation result。
- replay_failed case 能被明确交给 EngineerCat，且包含失败 assertion。
- ReviewerCat 关闭 case 时必须带 replay pass 证据。

## 22. 推荐下一步

建议实际落地顺序：

0. 已完成前置补强：`AgentToolExecutor`、skill core、ConversationRunner skill activation、AgentSession skill integration 的测试已补齐，当前基线为 `117 tests, 117 pass`。
1. 先实现 `FeedbackCaseStore` 和 types，不碰现有 AutoDev worker。
2. 写 detector，把现有 session JSONL 变成 case。
3. 写 mock replay runner，先让 3 个失败 case 可重放。
4. 写 rule evaluator，把 pass / fail 跑通。
5. 把 `case run` 接进 CLI。
6. 再接 EngineerCat / ReviewerCat。

这条路线的关键是：每一步都能独立验收，不需要等全自动闭环一次性完成。
