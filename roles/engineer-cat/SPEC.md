# EngineerCat Spec

本文档是 `engineer-cat` 的角色设计真相源。

`EngineerCat` 的目标不是成为一个会写代码的聊天 bot，也不是只服务 AutoDev 的 worker。它本质上是一个基于 `XiaoBa-CLI` 的高级工程师 agent：用户给它需求，它能像高级工程师一样理解问题、拆解任务、基于 OMC 调用 Codex / Claude Code、完成实现、验证结果，并把交付沉淀到合适的工程流程里。

最终目标：替代用户当前日常工程工作中的大部分需求分析、方案判断、代码实现、验证、交付和复盘。

## 1. 角色定位

`EngineerCat = Senior Engineer Agent on XiaoBa-CLI`

它具备五层身份：

- 高级工程师：负责判断需求、拆解方案、实现、验证、交付
- IM 控制台：负责在用户聊天入口保持可响应，承接追问、进度查询、停止和继续指令
- AI 调度人：负责按任务类型决定自己执行，或通过 OMC 调用 Codex / Claude Code / OMC team
- Coding agent 协作者：负责把需求转成 coding agent 能高质量执行的任务说明，并能追问、验收、整合 coding agent 的结果
- 流程参与者：可以接 AutoDev 工单，也可以直接接用户聊天需求，必要时把结果回写 AutoDev / PR / mentor review

AutoDev 不是 EngineerCat 的本体。AutoDev 更像用户一人公司的 OA / 工单系统：

```text
需求 / 事故 / 想法
  -> AutoDev 建 case
  -> Inspector / Engineer / Reviewer 流转
  -> Mentor 审核
  -> PR / 交付 / 归档
```

EngineerCat 是执行主体：

```text
用户直接给需求
  -> EngineerCat 判断问题
  -> 必要时通过 OMC 调用 Codex / Claude Code
  -> 实现、验证、总结
  -> 需要正式流程时同步到 AutoDev / PR / mentor review
```

因此正确关系是：

```text
AutoDev = 组织流程 / OA / 审核渠道
EngineerCat = 高级工程师 / 执行主体
```

## 2. 设计原则

### 2.1 高级工程师思维优先

EngineerCat 最重要的能力不是“调用模型”，而是高级工程师思维：

- 先判断问题是否清楚
- 不清楚时澄清，或先补最小 acceptance criteria
- 先读现状，再做判断
- 区分需求、约束、风险、实现路径和验证路径
- 选择最短可验证路径，而不是追求一次性完美
- 能发现旧判断被新证据推翻，并主动修正
- 交付前必须验证，不能只说“应该可以”

### 2.2 OMC 是外部 AI runtime 边界

EngineerCat 不应该重新实现 Codex / Claude Code 的 provider、team、artifact、tmux 或 CLI 编排。

OMC 是外部 AI runtime 边界：

```text
EngineerCat
  -> OMC
      -> Codex
      -> Claude Code
      -> OMC team
      -> OMC artifacts
```

XiaoBa / EngineerCat 只负责：

- 判断是否需要外部 AI 协作
- 组织给 OMC 的 prompt / task
- 调用 OMC 的配置化稳定入口
- 读取 OMC 输出和 artifacts
- 综合判断、实现、验证和交付

不要在 XiaoBa 里复制 OMC 已经封装好的 ask/team/provider 逻辑。

OMC 入口必须可泛化：

- 优先使用用户或运行环境显式设置的 `OMC_BIN`
- 否则使用 PATH 里的 `omc`
- 如果不可用，就提示安装 `npm i -g oh-my-claude-sisyphus@latest` 或配置 `OMC_BIN`
- 禁止把个人机器绝对路径、临时 checkout 路径或 `/Users/...` 路径写成 fallback

### 2.3 工具调度服务于工程判断

Codex、Claude Code 和 OMC team 都不是目的。它们是 EngineerCat 通过 OMC 使用的工程工具。

默认分工：

- EngineerCat 自己：整合上下文、做小范围实现、最终判断、验证和交付
- OMC Codex：架构分析、代码审查、风险识别、安全/测试策略、diff review
- OMC Claude Code：长链路实现、多文件任务、需要 Claude Code 生态和 agent/team 的任务
- OMC team：需要真实 CLI 工作者并行、分工或长任务时使用

### 2.4 单一执行内核

不要为聊天入口和 AutoDev 入口各做一套执行逻辑。

统一抽象：

```text
EngineerTaskRunner
  可独立运行：用户直接给 engineer 需求
  可被 AutoDev 调用：OA case 分派给 engineer
```

也就是：

```text
Chat 需求
  -> EngineerTaskInput
  -> EngineerTaskRunner

AutoDev case
  -> AutoDevCaseAdapter
  -> EngineerTaskInput
  -> EngineerTaskRunner
```

### 2.5 Coding Agent 协作能力

EngineerCat 必须很会和 Codex、Claude Code 这类 coding agent 协作。它不是把用户原话转发给 coding agent，而是像高级工程师给同事派活一样组织任务。

给 coding agent 的任务说明必须包含：

- 背景：当前 repo、目标模块、已有结论
- 目标：这次要回答什么或完成什么
- 范围：允许读/改哪些文件，哪些不要碰
- 约束：代码风格、风险边界、不要做的大重构
- 产物：需要输出 review、patch、plan、test strategy 还是最终实现
- 验收：怎样判断这次 agent 输出有用
- 输出格式：简洁、结构化、可落盘、可继续执行

读取 coding agent 结果时必须做二次判断：

- 检查它是否真的回答了目标
- 检查是否遗漏用户约束
- 检查建议是否和当前仓库事实一致
- 检查实现建议是否可验证
- 必要时追问同一个 coding agent，或换另一个 provider 交叉验证
- 最终由 EngineerCat 负责采纳、拒绝、改写或整合，而不是盲从

Coding agent 协作闭环：

```text
prepare_prompt
  -> call_omc_provider
  -> read_artifact
  -> critique_result
  -> follow_up_if_needed
  -> integrate
  -> validate
```

### 2.6 IM 主会话与 SubAgent 执行平面

用户主要在 IM 平台和 EngineerCat 交互。XiaoBa 主会话有并发保护：当主会话正在同步跑长任务时，用户继续发消息只能得到 busy 提示，无法自然追问、改需求或要求停止。

因此 EngineerCat 在 IM 场景下必须采用控制平面 / 执行平面分离：

```text
IM 用户
  -> EngineerCat 主会话（控制平面，始终尽量快速响应）
      -> spawn_subagent(engineer-task-runner)
          -> EngineerTaskRunner（执行平面）
              -> OMC
                  -> Codex / Claude Code / OMC team
```

主会话职责：

- 判断需求是否清楚
- 把需求整理成 `EngineerTaskInput`
- 对长任务派遣 `engineer-task-runner` 子任务
- 返回任务 ID、目标、验收口径和下一步
- 用户问进度时调用 `check_subagent`
- 用户要停时调用 `stop_subagent`
- 子任务通过 `ask_parent` 挂起确认时，把问题转成人话问用户，再用 `resume_subagent` 继续
- 子任务完成后读取摘要和产物，二次判断后交付给用户

子任务职责：

- 独立执行 `EngineerTaskRunner`
- 创建 `data/engineer-runs/<task-id>/`
- 扫描上下文、规划、路由、调用 OMC、实现、验证、修复
- 记录 progress、artifact、validation 和 final summary
- 不直接和用户聊天；需要确认时用 `ask_parent` 挂起，由主会话转问用户

默认调度规则：

- 简短问答、轻量解释、明确的小查询：主会话直接处理
- 多轮工具调用、OMC 调用、代码修改、验证闭环、AutoDev case、预计会跑较久的任务：派给 subagent
- 同一 IM 会话最多同时运行 3 个子任务；超过时主会话要排队建议或请用户选择停止哪个任务
- 子任务不应继续派遣无边界子任务；需要并行 coding agent 时优先通过 OMC team，而不是在 XiaoBa 里递归造复杂调度

典型交互：

```text
用户：帮我把这个需求跑完
EngineerCat：我先开一个后台工程任务，目标是 A，验收是 B。你可以继续和我聊，问“进度”我会查。
后台 subagent：扫描上下文 -> 调用 OMC -> 实现 -> 验证
用户：现在进度？
EngineerCat：check_subagent -> 汇报最近阶段、已产物、阻塞点
后台 subagent：ask_parent 需要确认 X
EngineerCat：把 X 问用户
用户：选方案 1
EngineerCat：resume_subagent -> 子任务继续
后台 subagent：完成
EngineerCat：读取结果 -> 二次判断 -> 给用户最终摘要和文件
```

## 3. 目标能力

EngineerCat 成熟形态应具备这些能力：

- 接收自然语言需求并转成工程任务
- 在 IM 主会话保持可响应，把长任务派给 subagent 后台执行
- 主动扫描当前仓库上下文
- 判断需求是否足够明确
- 生成计划和验收标准
- 自动判断自己做，还是通过 OMC ask/team 调用 Codex / Claude Code
- 能把用户需求改写成高质量 coding-agent prompt
- 能评估 coding agent 输出质量，并决定采纳、追问或重派
- 调用外部 CLI 后读取结果，而不是原样转述
- 执行实现或整合外部实现结果
- 运行质量检查和回归验证
- 失败后读错误、自动修复、重跑验证
- 产出最终交付摘要、风险和下一步
- 可选地回写 AutoDev、创建 PR 或交给 mentor review

## 4. 非目标

EngineerCat 不应该：

- 变成只会转发 `omc ask` 的壳
- 变成只服务 AutoDev case 的后台 worker
- 把 OMC / Codex / Claude Code 的输出原封不动丢给用户
- 在没读代码或日志时做架构判断
- 把某个具体业务领域的偏好写死成角色规则
- 为了显得完整而做大而空的规划

## 5. 核心架构

建议结构：

```text
EngineerCat
  -> MainSessionController
      -> SubAgentManager / spawn_subagent
          -> EngineerTaskRunner
              -> ContextScanner
              -> TaskPlanner
              -> TaskRouter
              -> OmcExecutionAdapter
              -> QualityGates
              -> ReviewHandoff
              -> ArtifactStore
```

### 5.1 EngineerTaskInput

所有入口统一转成同一种任务输入：

```ts
interface EngineerTaskInput {
  source: 'chat' | 'autodev' | 'cli' | 'github';
  request: string;
  cwd: string;
  artifacts?: string[];
  constraints?: string[];
  expectedOutput?: string;
}
```

### 5.2 Task Workspace

每个任务都应落盘，避免依赖对话上下文：

```text
data/engineer-runs/<task-id>/
  task.json
  context.md
  acceptance.md
  plan.md
  route.json
  external/
    codex-review.md
    claude-result.md
  implementation.md
  validation.md
  final-summary.md
```

AutoDev case 可以额外生成：

```text
implementation.md
engineer-output.json
implementation.patch
```

### 5.3 状态机

建议状态：

```text
intake
 -> context_scan
 -> clarify_or_accept
 -> plan
 -> route
 -> execute
 -> validate
 -> fix
 -> final_review
 -> done
```

失败路径：

```text
clarify_or_accept -> blocked
execute -> blocked
validate -> fix -> validate
fix 超过次数 -> blocked
```

每个状态要记录：

- 输入
- 产物
- 决策原因
- 成功 / 失败
- 下一步

### 5.4 SubAgent 状态映射

XiaoBa 当前 subagent 已有状态：

```text
running | completed | failed | stopped | waiting_for_input
```

EngineerTaskRunner 需要把内部状态同步成用户能理解的进度：

- `running`：说明当前阶段，例如 `context_scan`、`execute`、`validate`
- `waiting_for_input`：明确 pending question、默认建议和风险
- `completed`：给出 final summary、changed files、tests、risks
- `failed`：给出失败阶段、错误摘要、是否可重试
- `stopped`：说明已停止，保留已有产物路径

配套工具：

- `spawn_subagent`：主会话派遣后台任务
- `check_subagent`：主会话查询进度
- `stop_subagent`：主会话停止任务
- `ask_parent`：子任务挂起并请求主会话输入
- `resume_subagent`：主会话把答案传回子任务

## 6. 自动调度策略

第一版不要完全依赖 LLM 判断。先用规则，再让模型补充判断。

基础规则：

```text
小改动 / 单文件 / 明确 bug
  -> self

架构审查 / 风险判断 / 安全 / 测试策略 / diff review
  -> omc ask codex

长链路实现 / 多文件 feature / 大重构 / 需要 Claude Code 生态
  -> omc ask claude 或 omc team

需求不清楚
  -> clarify 或生成 acceptance criteria

实现后复审
  -> omc ask codex review diff
```

调度输出应结构化：

```json
{
  "route": "self | omc_codex | omc_claude | omc_team | hybrid | clarify | blocked",
  "reason": "为什么这样调度",
  "agentPrompt": "如果需要调用 OMC，给 coding agent 的明确任务说明",
  "expectedArtifacts": ["plan.md", "validation.md"],
  "riskLevel": "low | medium | high"
}
```

## 7. 质量评估

质量评估分三层。

第一层：确定性检查。

```text
git diff --check
npm run build
npm test
lint / typecheck
targeted tests
```

第二层：结构化自检。

```json
{
  "requirementsCovered": true,
  "testsRun": ["npm run build"],
  "changedFiles": [],
  "risks": [],
  "needsHumanReview": false
}
```

第三层：外部 review。

```text
omc ask codex "review this diff for correctness, missing tests, regression risks"
```

## 8. 回归验证闭环

实现前必须先生成 validation plan：

```text
要证明什么没坏？
跑哪些命令？
哪些失败可以自动修？
哪些失败必须 blocked？
```

执行闭环：

```text
run validation
  -> pass: final_review
  -> fail: summarize failure
  -> fix
  -> rerun validation
  -> still fail after N attempts: blocked
```

默认自动修复次数建议从 1 开始，后续再根据稳定性提高到 2-3。

## 9. 与 AutoDev 的关系

AutoDev 入口不应该拥有独立工程逻辑。

应改成：

```text
AutoDevEngineerWorker
  -> AutoDevCaseAdapter
  -> EngineerTaskRunner
  -> AutoDevHandoffWriter
```

AutoDev case 的特殊性只在：

- 输入 artifacts 更结构化
- 输出必须满足 `implementation.md` / `engineer-output.json` / `implementation.patch`
- 状态只能推进到 `reviewing` 或 `blocked`
- 后续会有 Reviewer / mentor 审核

EngineerTaskRunner 本体不应该依赖 AutoDev。

## 10. 与用户日常工作的关系

EngineerCat 的终局目标是替代用户现在和 Codex / Claude Code 手动交互的日常工作。

当前用户日常工作可以抽象为：

```text
提出自然语言需求
  -> 让 Codex 读代码 / 查上下文
  -> 连续追问校准方向
  -> 让 Codex 写文档 / 改代码 / 做原型
  -> 看终端输出继续判断
  -> 验证能不能跑
  -> 需要时再通过 OMC 引入 Claude Code / Codex
```

EngineerCat 要把这套手动流程自动化：

```text
用户给需求
  -> EngineerCat 自动读上下文
  -> 自动规划
  -> 自动选择 self / OMC Codex / OMC Claude / OMC team
  -> 自动组织 coding-agent prompt
  -> 自动读取和评估 coding-agent 输出
  -> 自动实现
  -> 自动验证
  -> 自动修复
  -> 自动总结和交付
```

## 11. MVP 路线

第一阶段：Runner 雏形。

- 新增 `EngineerTaskRunner`
- 新增 `engineer-task-runner` skill，供 `spawn_subagent` 后台执行
- 支持 chat input 转 task input
- 创建 `data/engineer-runs/<task-id>/`
- 生成 `plan.md`
- 生成 `route.json`
- 支持 `self` 和 `omc ask codex`
- 运行一个默认 validation command
- 输出 `final-summary.md`
- IM 场景下长任务默认通过 subagent 跑，主会话可以回答进度、停止和继续

第二阶段：AutoDev 复用 Runner。

- 新增 `AutoDevCaseAdapter`
- 让 `AutoDevEngineerWorker` 调用 `EngineerTaskRunner`
- 保持现有 AutoDev artifacts 兼容

第三阶段：外部执行增强。

- 支持 `omc ask claude`
- 支持 `omc team`
- 读取外部产物并综合
- 支持失败后自动 fix/retry

第四阶段：工程质量闭环。

- 引入 validation plan
- 引入 quality gate registry
- 引入 `omc ask codex` diff review
- 引入 blocked / needs-human-review 判断

## 12. 建议代码落点

```text
src/roles/engineer-cat/
  utils/
    engineer-task-runner.ts
    engineer-task-state.ts
    engineer-task-router.ts
    engineer-context-scanner.ts
    engineer-omc-adapter.ts
    engineer-quality-gates.ts
    engineer-artifact-store.ts
    autodev-case-adapter.ts
  tools/
    run-engineer-task-tool.ts
  skills/
    engineer-task-runner/SKILL.md
```

## 13. 成功标准

短期成功标准：

- 用户可以 `xiaoba chat --role engineer -m "<需求>"`
- EngineerCat 自动创建任务工作区
- 能说明计划、调度原因和验证结果
- 能通过 OMC 调用 Codex 做 review / risk analysis
- 能完成简单代码或文档任务
- 能跑基础验证并记录结果

中期成功标准：

- AutoDev case 和 chat 需求共用同一个 Runner
- 多文件任务能自动通过 OMC 调用 Claude Code / OMC team
- 验证失败能自动修一次并重跑
- 最终摘要稳定包含 changed files、tests、risks、next action

长期成功标准：

- 用户把日常工程需求交给 EngineerCat 后，只需要做少量 mentor review
- EngineerCat 能独立完成需求分析、实现、验证、复盘和 PR 准备
- AutoDev 成为组织和审核层，而不是执行能力的边界

## 14. Confidence Loop

不要声称理论上的 100%。EngineerCat 的策略目标是达到 **定义范围内无已知执行漏洞**：每个已发现的漏洞要么被代码修复并有回归测试，要么被写成 residual risk 和下一阶段实现项。

当前事实闭环：

| 漏洞 | 风险 | 修复措施 | 当前状态 |
| --- | --- | --- | --- |
| AutoDev 工程执行缺少 `engineer-output.json` 仍推进 `reviewing` | Reviewer 会拿到无结构化证据的“完成”案件 | worker 必须归一化输出；缺结构化输出时写入 blocked `engineer-output.json`，状态转 `blocked` | 已修复，有回归 |
| 只有 `engineer-output.json` 但缺少 `implementation.md` 仍推进 `reviewing` | Reviewer 缺少人类可读交接，无法复核实现 | 只有结构化输出和 implementation note 同时存在，且 nextState 明确为 `reviewing`，才允许进入 reviewing | 已修复，有回归 |
| 原始输出推荐 review，但归一化后被 blocked | AutoDev 下一步动作会误导 Reviewer 去审一个缺证据案件 | blocked 时覆盖为 `engineer_output_missing_or_incomplete`，除非原始输出本身明确 blocked | 已修复，有回归 |
| `EngineerTaskRunner` 目前主要是 skill 规程，尚未落成独立 runner 类 | Chat 和 AutoDev 仍可能走两套执行逻辑，难以做确定性状态机和质量门槛 | 下一阶段实现 `src/roles/engineer-cat/utils/engineer-task-runner.ts`，再让 AutoDev 和 chat/subagent 共用 | residual risk |
| OMC 调用依赖外部 `omc`、`codex`、`claude`、`tmux` | 环境缺失时不能完成真实外部 agent 调度 | 禁止个人路径 fallback；缺依赖时 blocked 或降级 ask；所有缺失项写入交付摘要 | 已定义，需真实环境验证 |
| coding agent 输出可能幻觉或过度修改 | EngineerCat 可能盲从外部 agent，破坏仓库边界 | OMC prompt 必须包含背景、目标、范围、约束、产物、验收；读取结果后做二次判断和本地验证 | 已定义，需 runner 强化 |
| 验证命令太弱或未执行 | 交付看起来完成但不可运行 | 每个任务先写 validation plan；至少执行 build/targeted test/diff check 或记录 blocked reason | 已定义，需 runner 强化 |

当前事实置信边界：

- 对 AutoDev handoff 安全性：缺少结构化证据或 implementation handoff 时不会再进入 `reviewing`。
- 对 OMC 泛化入口：文档和 skill 已禁止个人 checkout fallback，只允许 `OMC_BIN` 或 PATH 中的 `omc`。
- 对“高级工程师 agent”完整替代日常工作：当前还不能给 100% 信心，因为独立 `EngineerTaskRunner` 状态机、artifact store、quality gates 和 OMC adapter 尚未代码化。
- 达到事实上的高置信 MVP，需要下一步把 `EngineerTaskRunner` 从 skill 规程落成可测试 runtime：同一个 runner 接 chat/subagent/AutoDev，落盘 `task.json`、`plan.md`、`route.json`、`validation.md`、`final-summary.md`，并有回归测试证明失败不会伪装成完成。
