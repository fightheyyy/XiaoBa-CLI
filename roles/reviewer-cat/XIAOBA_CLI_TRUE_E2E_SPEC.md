# ReviewerCat XiaoBa-CLI True E2E Adapter Spec

本文定义一个最佳实践方案：让 `ReviewerCat` 像人类测试人员一样，端到端测试 `XiaoBa-CLI` 自己。

这里的 `ReviewerCat` 不是普通 test runner，也不是只读代码的 reviewer。它是一个拟人测试员：会提出需求、等待回复、回答澄清问题、追问进度、要求证据、指出遗漏、要求返工，并最终基于独立证据决定通过、失败或阻塞。

`XiaoBa-CLI` 是第一个被测项目，因为它同时覆盖 CLI、agent runtime、role、skill、subagent、dashboard、pet、Feishu bridge、AutoDev worker 等多种项目形态。先从自己开始，可以把 ReviewerCat 的通用测试抽象打磨出来，再迁移到任意项目。

## 1. 目标

### 1.1 核心目标

构建一个 `XiaoBaCliTrueE2EAdapter`，让 ReviewerCat 能通过和人类相同或近似相同的入口测试 XiaoBa-CLI：

- 终端入口：`xiaoba --role engineer-cat chat --interactive`
- 一次性 CLI：`xiaoba --role engineer-cat chat -m "..."`
- 直接 runtime session：`AgentSession`
- Dashboard HTTP API
- Pet HTTP/SSE 交互
- Feishu/Bot Bridge 群聊交互

第一版以 **tmux 黑盒交互** 和 **direct runtime 结构化交互** 为主。

### 1.2 真实端到端定义

一次测试只有满足以下条件，才算 true E2E：

1. 从真实入口启动被测对象，而不是直接调用内部函数冒充用户行为。
2. ReviewerCat 通过自然语言和被测 agent 交互，而不是直接改内部状态。
3. 被测 agent 需要自己理解需求、调用工具、交付结果。
4. ReviewerCat 不能相信被测 agent 的自评，必须独立验证。
5. 全流程必须保存可复查 trace。
6. 失败时必须能 resume / rework，而不是只给一次性结论。

### 1.3 非目标

- 不把单测或集成测试包装成 E2E。
- 不让 ReviewerCat 绕过对话接口直接控制 EngineerCat。
- 不要求第一版覆盖所有 surface。
- 不追求一开始就设计复杂通用 A2A 协议。

## 2. 最佳总体方案

最佳方案是 **分层 adapter**，而不是只选 tmux、CLI、runtime 或飞书其中之一。

```text
ReviewerCat Core
  ├─ Eval Planner
  ├─ Human Simulator
  ├─ Interaction Policy
  ├─ Independent Verifier
  ├─ Trace Recorder
  └─ Scorecard / Decision Engine

XiaoBaCliTrueE2EAdapter
  ├─ tmux surface adapter          # 最像人，黑盒 E2E
  ├─ direct runtime adapter        # 稳定，结构化，可控
  ├─ one-shot CLI adapter          # CLI smoke / bad input
  ├─ dashboard HTTP adapter        # 管理台入口
  ├─ pet HTTP/SSE adapter          # 本地具身交互入口
  └─ bridge / Feishu adapter       # 群聊 A2A 场景
```

排序建议：

1. `direct runtime adapter`：先把状态机、trace、评分、返工闭环做稳。
2. `tmux adapter`：验证真人终端体验，作为 true black-box E2E 主证据。
3. `dashboard/pet adapter`：验证本地 UI / embodied interaction。
4. `bridge/feishu adapter`：验证群聊协作和 A2A 场景。

## 3. 为什么 tmux 是关键，但不能只靠 tmux

tmux 是最接近真人使用的方式：

```bash
tmux new-session -d -s reviewer-eval-123 \
  "cd /repo && node dist/index.js --role engineer-cat chat --interactive"

tmux send-keys -t reviewer-eval-123 "帮我实现这个需求..." C-m
tmux capture-pane -pt reviewer-eval-123 -S -5000
tmux send-keys -t reviewer-eval-123 "这个边界漏了，继续修" C-m
tmux kill-session -t reviewer-eval-123
```

它能真实覆盖：

- CLI 是否能启动
- role 是否能激活
- interactive 输入是否可用
- agent 是否会响应用户
- 长任务是否能持续
- agent 内部调用 Codex / Claude / OMC 时是否会卡住
- 用户追问、返工、继续交互是否自然

但 tmux 也有弱点：

- 输出包含 ANSI / spinner / 动态刷新，解析不稳定。
- 等待条件不如 runtime 结构化。
- tool call / artifact 需要从 session log 和文件系统补证据。
- 并发时要严格管理 session name 和 cleanup。

因此 tmux 应该是 **黑盒证据层**，direct runtime 应该是 **结构化控制层**。

## 4. Local Agent Interaction Adapter

不建议一开始做大而全 A2A 协议。第一版只需要一个本地 agent 交互 adapter。

```ts
interface AgentInteractionAdapter {
  start(input: StartAgentInput): Promise<AgentHandle>;
  send(input: SendAgentMessageInput): Promise<void>;
  observe(input: ObserveAgentInput): Promise<AgentInteractionSnapshot>;
  requestRework(input: ReworkAgentInput): Promise<void>;
  stop(input: StopAgentInput): Promise<void>;
}
```

建议类型：

```ts
type AgentSurface =
  | 'direct-runtime'
  | 'tmux'
  | 'cli'
  | 'dashboard-pet'
  | 'feishu-bridge';

interface StartAgentInput {
  runId: string;
  role: 'engineer-cat' | 'reviewer-cat' | string;
  cwd: string;
  surface: AgentSurface;
  sessionKey?: string;
  command?: string;
  env?: Record<string, string>;
}

interface AgentHandle {
  runId: string;
  sessionId: string;
  surface: AgentSurface;
  cwd: string;
  startedAt: string;
  traceDir: string;
}

interface SendAgentMessageInput {
  sessionId: string;
  text: string;
  as?: 'human' | 'reviewer' | 'system';
}

interface AgentInteractionSnapshot {
  sessionId: string;
  state: 'starting' | 'running' | 'waiting' | 'completed' | 'failed' | 'stopped';
  messages: AgentMessageEvent[];
  toolCalls: AgentToolCallEvent[];
  artifacts: AgentArtifactEvent[];
  rawTracePaths: string[];
}
```

事件模型：

```ts
type AgentTestEvent =
  | { type: 'human_message'; text: string; at: string }
  | { type: 'agent_message'; text: string; at: string }
  | { type: 'tool_call'; name: string; args: unknown; result?: string; at: string }
  | { type: 'artifact'; path: string; kind: string; at: string }
  | { type: 'state'; state: string; reason?: string; at: string }
  | { type: 'verifier_result'; command: string; status: string; at: string };
```

## 5. ReviewerCat 的拟人测试状态机

ReviewerCat 测 XiaoBa-CLI 时，不应该像脚本一样只打一条命令。它应该像真人 tester 一样推进：

```text
create run workspace
-> call reviewer_eval_prepare
-> choose scenario
-> start target surface
-> send human-like requirement
-> observe response
-> if target asks clarification: answer from scenario policy
-> if target stalls: ask concise progress question
-> if target claims done: request evidence
-> run independent verifier
-> if verifier fails: send human-like rework feedback
-> repeat until pass/fail/max_turns/timeout
-> write scorecard and decision
```

拟人行为不是闲聊，而是有测试目的：

- 需求不清楚时，让被测 agent 主动澄清。
- 被测 agent 过早说完成时，要求 evidence。
- 被测 agent 没有测试时，追问“你跑了什么验证？”。
- 独立验证失败时，把失败日志作为返工反馈。
- 达到 max turns 仍没有证据时，判 `failed` 或 `blocked`。

## 6. Trace 保存策略

Trace 是这个方案的核心。没有 trace，ReviewerCat 的结论就不可复查。

### 6.1 自动已有 trace

XiaoBa-CLI 已经有 `SessionTurnLogger`，默认写：

```text
logs/sessions/<session_type>/<YYYY-MM-DD>/<session_type>_<safe_session_id>.jsonl
```

每轮包含：

- user text
- assistant text
- tool calls
- tool result tail
- token usage
- runtime log

这个自动 trace 应该被 adapter 记录到 manifest 里，而不是重复造轮子。

### 6.2 Reviewer run trace

每次 E2E eval 额外创建：

```text
data/reviewer-runs/<run-id>/
  task.json
  evaluation-profile.md
  review-eval-plan.md
  boundary-map.md
  test-matrix.md
  trace/
    manifest.json
    normalized-transcript.jsonl
    tmux-pane.raw.log
    tmux-pane.clean.log
    cli-commands.jsonl
    http-requests.jsonl
    sse-events.jsonl
    session-log-paths.json
  evidence/
    git-status.before.txt
    git-status.after.txt
    diff.patch
    verifier-*.stdout.log
    verifier-*.stderr.log
  scorecard.json
  report.md
```

### 6.3 Manifest

`trace/manifest.json` 至少包含：

```json
{
  "version": 1,
  "runId": "xiaoba-e2e-...",
  "project": "xiaoba-cli",
  "surface": "tmux",
  "targetRole": "engineer-cat",
  "cwd": "/Users/guowei/XiaoBa-CLI",
  "startedAt": "...",
  "completedAt": "...",
  "sessionIds": [],
  "sessionLogPaths": [],
  "tmuxSession": "reviewer-eval-...",
  "commands": [],
  "verifiers": [],
  "artifacts": [],
  "decision": "pass | fail | partial | blocked"
}
```

## 7. XiaoBa-CLI 第一批真实 E2E 场景

### 7.1 CLI 基础可用性

目的：确认用户从 shell 里能启动 XiaoBa。

检查：

- `node dist/index.js --help`
- `node dist/index.js --definitely-not-real`
- `node dist/index.js --role reviewer-cat --help`
- `node dist/index.js --role engineer-cat --help`

证据：

- exit code
- stdout/stderr
- help 文案
- bad input 错误提示

### 7.2 EngineerCat 终端交互

目的：确认 EngineerCat 能像高级工程师一样响应需求。

surface：`tmux`

流程：

1. 创建隔离 fixture repo，不直接污染 XiaoBa 主仓库。
2. tmux 启动 `node dist/index.js --role engineer-cat chat --interactive`。
3. ReviewerCat 发送一个小型工程需求。
4. 观察 EngineerCat 是否澄清、计划、调用工具或 coding agent。
5. EngineerCat 说完成后，ReviewerCat 独立验证 fixture。
6. 验证失败则把失败日志发回 tmux，要求返工。

注意：如果测试目标是 XiaoBa 自身代码，可以使用临时 worktree 或 disposable branch。默认不允许直接改主工作区。

### 7.3 Role / Skill 激活链路

目的：确认 role、prompt、skill、tool 在真实入口可达。

检查：

- reviewer-cat role 能看到 `reviewer_eval_prepare`
- engineer-cat role 能加载 OMC / engineer-task-runner skill
- 基础 ToolManager 不污染 role-specific tools
- runtime role registry 注入正确

证据：

- CLI transcript
- session JSONL
- role-aware ToolManager 输出
- `reviewer_eval_prepare` 生成的 run artifacts

### 7.4 Dashboard smoke

目的：确认本地管理台真实可启动。

流程：

1. 启动 `node dist/index.js dashboard --port <free-port> --host 127.0.0.1`
2. 请求 `/api/status`
3. 请求 `/api/roles`
4. 请求 `/api/skills`
5. 停止服务

证据：

- server log
- HTTP status/body
- cleanup status

### 7.5 Pet 交互 smoke

目的：确认本地 pet 入口能像用户一样发消息和接收事件。

流程：

1. 启动 Pet HTTP 服务。
2. `POST /api/pet/wake`
3. `POST /api/pet/message`
4. `GET /api/pet/events?replay=1`

证据：

- HTTP request/response
- SSE events
- session key `pet:<id>`
- session JSONL

### 7.6 Feishu Bridge / 群聊 A2A 场景

目的：确认已有 Bot Bridge 能作为真实群聊协作 transport。

现有可复用能力：

- `BridgeMessage`：`from/chat_id/message/task_id/callback_url/conversation_id`
- `/bot-message`
- `/bot-result`
- `/group-message`
- `BridgeClient.broadcast`
- chime-in judge

第一版不把它作为默认 E2E surface，因为它有 LLM 插嘴判断和真实群聊噪音。它更适合作为后续 `surface=feishu-bridge`。

## 8. Independent Verifier

ReviewerCat 的独立验证必须和交互层分开。

示例 verifier：

```json
[
  {
    "name": "build",
    "command": "npm run build",
    "level": "static"
  },
  {
    "name": "targeted-tests",
    "command": "npx tsx --test tests/tool-manager-roles.test.ts tests/reviewer-eval-profile.test.ts",
    "level": "integration"
  },
  {
    "name": "cli-help",
    "command": "node dist/index.js --help",
    "level": "smoke"
  }
]
```

Verifier 输出进入：

```text
data/reviewer-runs/<run-id>/evidence/verifier-*.stdout.log
data/reviewer-runs/<run-id>/evidence/verifier-*.stderr.log
```

只有 verifier 通过，且 trace 能证明真实交互完成，才允许 `decision=pass`。

## 9. Scorecard

`scorecard.json` 建议结构：

```json
{
  "version": 1,
  "runId": "xiaoba-e2e-...",
  "target": {
    "project": "xiaoba-cli",
    "role": "engineer-cat",
    "surface": "tmux"
  },
  "decision": "pass",
  "score": 86,
  "dimensions": {
    "entrypointReality": 20,
    "humanLikeInteraction": 15,
    "taskCompletion": 20,
    "independentVerification": 20,
    "traceCompleteness": 15,
    "reworkBehavior": 10
  },
  "deductions": [],
  "evidence": {
    "traceManifest": "trace/manifest.json",
    "sessionLogs": [],
    "verifierLogs": [],
    "artifacts": []
  },
  "reworkTurns": 0,
  "residualRisks": []
}
```

评分规则：

- 入口不真实，最高 60。
- 无 trace，最高 50。
- 无独立验证，最高 65。
- 只跑单测无 E2E，最高 70。
- 被测 agent 完成但无法解释证据，扣 10-25。
- ReviewerCat 介入过多、替被测 agent 做了任务，扣 20-40。

## 10. 复用现有飞书 A2A Bridge 的方式

现有 Bridge 可以复用为 `bridge transport`，但不要直接成为核心协议。

应该抽象为：

```text
AgentInteractionAdapter
  -> BridgeTransport
      -> BridgeClient / BridgeServer
```

需要补的字段：

- `run_id`
- `surface`
- `role`
- `event_type`
- `artifact_paths`
- `state`
- `trace_id`

现有 `/group-message` 适合“旁听群聊上下文”，现有 `/bot-message` 适合“点对点派任务”，现有 `/bot-result` 适合“异步结果回传”。

不要在 deterministic eval 中默认启用 chime-in judge。测试时应该显式指定谁说话、什么时候说话、为什么说话。

## 11. 实现路线

### Phase 1: 类型和 trace recorder

新增：

```text
src/roles/reviewer-cat/adapters/types.ts
src/roles/reviewer-cat/adapters/trace-recorder.ts
src/roles/reviewer-cat/adapters/xiaoba-cli-adapter.ts
```

能力：

- 创建 run dir
- 写 manifest
- 写 normalized transcript
- 收集 session log path
- 保存 git status / diff / verifier logs

### Phase 2: direct runtime adapter

新增：

```text
src/roles/reviewer-cat/adapters/direct-runtime-agent-adapter.ts
```

能力：

- 用 `AgentSession` 启动目标 role
- 注入 fake channel 或 capture channel
- 记录 tool calls 和 agent text
- 支持 send / observe / stop

### Phase 3: tmux adapter

新增：

```text
src/roles/reviewer-cat/adapters/tmux-agent-adapter.ts
```

能力：

- `tmux new-session`
- `tmux send-keys`
- `tmux capture-pane`
- ANSI 清理
- 超时和 cleanup
- 保存 raw pane 和 clean pane

当前落地版还提供 `process surface` 作为自动降级入口：当 `surface=auto` 且本机没有 tmux 时，ReviewerCat 仍会启动真实 CLI 子进程，通过 stdin/stdout 发送人类消息并保存 trace。这个入口不如 tmux 像真人终端，但可以避免“环境缺一个 tmux 就完全无法验收”的硬阻塞；报告必须把 fallback reason 写入 manifest、scorecard 和 residual risks。

### Phase 4: reviewer tool

新增工具：

```text
reviewer_xiaoba_cli_e2e
```

参数：

```json
{
  "surface": "auto | tmux | process",
  "target_role": "engineer-cat",
  "scenario": "basic-engineering-task",
  "cwd": "/Users/guowei/XiaoBa-CLI",
  "messages": ["用户需求或追问"],
  "verifier_commands": [
    {"name": "cli-help", "command": "node dist/index.js --help"}
  ]
}
```

输出：

```text
reviewer_xiaoba_cli_e2e: status=pass|fail|partial|blocked
run_id=...
score=...
trace_manifest=data/reviewer-runs/<run-id>/trace/manifest.json
report=data/reviewer-runs/<run-id>/report.md
```

### Phase 5: dashboard / pet / bridge surfaces

在 core 稳定后再加：

- Dashboard HTTP adapter
- Pet HTTP/SSE adapter
- Bridge / Feishu adapter

## 12. 关闭标准

一次 XiaoBa-CLI true E2E eval 可以关闭，必须满足：

- 有 `review-eval-plan.md`
- 有真实 surface trace
- 有 session JSONL 或等价 transcript
- 有 verifier logs
- 有 scorecard
- 被测 agent 没有被 ReviewerCat 特权控制
- 所有 required checks 通过，或 blocked reason 被明确记录

不能关闭的情况：

- 只有 engineer 自述“已完成”
- 只有单测，没有入口验证
- tmux / CLI / HTTP trace 缺失
- verifier 失败但没有返工
- 被测 agent 没有真正收到需求
- ReviewerCat 直接替被测 agent 修改代码

## 13. 最佳第一版

最小但正确的第一版：

1. `reviewer_eval_prepare` 生成验收计划。
2. `reviewer_xiaoba_cli_e2e surface=auto` 跑一个 engineer-cat 小场景；有 tmux 时保存 pane trace，没有 tmux 时自动降级到 process surface 并记录 fallback reason。
3. `tmux` 跑一个真正 interactive 场景，作为最像真人终端的主证据；如果环境缺失，不能伪装为 tmux 通过。
4. `node dist/index.js --help` 和 bad input 做 CLI smoke。
5. Dashboard `/api/status` 做服务 smoke。
6. `npm run build` 和 targeted tests 做 verifier。
7. 输出 `scorecard.json` 和 `report.md`。

这就是 ReviewerCat 从“会写测试计划”进化到“真的像人一样测试 XiaoBa-CLI”的第一步。

## 14. Confidence Loop

不要声称理论上的 100%。ReviewerCat 的目标是达到 **定义范围内无已知漏洞**：每个已发现的漏洞要么被修复并有回归测试，要么被写成 residual risk 和 blocked prerequisite。

本策略的事实闭环：

| 漏洞 | 风险 | 修复措施 | 当前状态 |
| --- | --- | --- | --- |
| 本机没有 tmux 时 true E2E 直接 blocked | reviewer 无法替人完成最小真实验收 | `surface=auto` 默认优先 tmux，缺失时降级到 process surface；manifest/scorecard/report 写入 fallback reason | 已修复，有回归 |
| fallback 通过但被写成 blocked reason | 报告语义污染，后续判断会误读 | `blockedReason` 和 `fallbackReason` 分离；通过时只写 fallback，不写 blocked | 已修复，有回归 |
| process surface 不是真 TTY | 不能覆盖终端渲染、快捷键、交互式提示等问题 | scorecard 降低 entrypointReality 分；residual risks 明确记录；需要最高置信时强制 `surface=tmux` | 已缓解 |
| completion pattern 过弱 | agent 输出“完成”但实际没完成 | completion signal 只占一部分分数；必须配合 verifier commands 和 trace review | 已缓解，需按项目增强 verifier |
| 没有 XiaoBa session JSONL | 只能证明 CLI stdout，不一定证明 runtime 内部 session | session log 缺失不直接 fail，但扣分并写 residual risk | 已缓解 |
| verifier 太弱 | `--help` 只能证明入口未炸 | 工具允许传入项目级 verifier；ReviewerCat 必须从 eval plan 推导 verifier_commands | 策略已定义，场景需补足 |
| 被测 agent 需要 API key / Codex / Claude / OMC | 外部依赖缺失会导致真实 engineer-cat 无法完成任务 | 不绕过依赖；记录 blocked reason，或用最小 smoke 验证 adapter 本身 | 已定义 |

当前事实置信边界：

- 对 adapter 自身：构建、targeted tests、全量测试和 process fallback smoke 通过时，可以认为“无已知实现漏洞”。
- 对真实 engineer-cat 能力：必须在具备真实依赖的环境里运行 `reviewer_xiaoba_cli_e2e`，并配置足够强的 verifier，才能给出高置信结论。
- 对“像人一样测试”：tmux 是主证据；process 只能作为缺 tmux 时的保底证据，不能等价替代真人终端体验。
