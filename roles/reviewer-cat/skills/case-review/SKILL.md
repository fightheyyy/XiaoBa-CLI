---
name: case-review
description: 根据 Inspector Replay Case 与 Engineer evidence，在干净 session 中执行正式回放，并返回 DAG 唯一 Reviewer v1 合同。
version: 1.0.0
author: ReviewerCat Team
user_invocable: true
invocable: both
argument-hint: "<Inspector route 或 Replay Case 路径>"
max-turns: 24
---

# Case Review

这个 Skill 只负责单 Replay Case 的正式回放与关闭判断。InspectorCat 写用例，EngineerCat 修复，ReviewerCat 独立回放；Candidate Skill / Role 的多 case 评测属于 Arena。

## Replay Case 输入合同

只接受 DAG 已定义的四个字段，不另造 schema：

```json
{
  "id": "retry-case",
  "intent": "在干净 session 中重复原失败行为",
  "expected_outcome": "用户可见结果稳定交付",
  "source_trace_refs": ["trace:a"]
}
```

- `id`：稳定 case id
- `intent`：要重放的原始用户意图和最小动作
- `expected_outcome`：冻结后的用户可观察结果
- `source_trace_refs`：至少一个可追溯原始 Trace 引用

ReviewerCat 可以从 source Trace 恢复具体输入与观察点，但不能修改 `intent` 或 `expected_outcome` 来迎合候选结果。四个字段不足以用当前确定性工具安全重放时，返回 `blocked`，不要要求 Inspector 再发明一套扩展合同。

## 唯一输出合同

正式 DAG 只返回下面一个 version 1 JSON 对象，不返回 prose，也不使用其他状态字段：

```json
{
  "version": 1,
  "status": "closed|next_run|blocked",
  "summary": "一句话结果",
  "evidence_refs": ["fresh replay or verification ref"],
  "reason": "blocked 时必填；其他状态可省略"
}
```

- `closed`：干净 session 的正式回放通过；`evidence_refs` 至少包含一个本轮新证据
- `next_run`：问题已复现或修复未通过；`evidence_refs` 至少包含一个本轮失败证据。DAG runtime 负责生成下一轮 seed
- `blocked`：缺环境、权限、可执行入口或安全回放能力；`reason` 必填，`evidence_refs` 可以为空
- 不输出 `decision`、`nextState`、`recommendedNextOwner`、`replayStatus` 或第二套 evidence 字段

## 定时 DAG 的工具边界

当父 session 是 `evolution:dag:*` 时：

- 先且只调用一次 `reviewer_trace_replay({})`；它从可信 parent date 唯一推导 Inspector route 和固定 `reviewer-replay/` 输出目录
- `reviewer_xiaoba_cli_e2e` 被 runtime 硬阻止，因为它允许自定义 command、messages 和 verifier commands
- `reviewer_module_test` 也被 runtime 硬阻止，因为自定义或项目测试命令可能修改工作区
- `reviewer_trace_replay` 只接受空参数；不得传 cwd、路径、命令、消息或 verifier
- 可用 `read_file`、`grep`、`glob` 读取它生成的 fresh report/comparison
- `closed/next_run` 的 `evidence_refs` 只能引用本轮固定 `reviewer-replay/` 下的 manifest、replay-results、comparison 或 report
- 不能把已有 Engineer/CI 自评直接算作 fresh replay evidence
- 工具 blocked 或没有安全、独立、可重复的正式回放证据时返回 `blocked`；不能为追求 `closed` 绕过 runtime 边界
- 最小 replay 会在只读 runtime 中恢复原 Trace 的 Base 或可调用 Role；写文件、Shell、subagent、外发、slash command、缺失 Role 或其他副作用任务必须 fail closed 为 `blocked`

普通 Reviewer 会话仍可按用户明确要求使用通用 E2E 或模块测试工具；上述限制只由可信的 DAG parent session 触发。

## 正式回放流程

1. 读取 Inspector route、Replay Case、source Trace，以及可选 Engineer result
2. 校验四字段输入合同并冻结 `expected_outcome`
3. 定时 DAG 调用 `reviewer_trace_replay({})`；普通会话确认允许的工具能否安全完成独立回放
4. 在与原 session 隔离的只读干净 session 中重放，隔离历史消息、memory、缓存和登录态
5. 按 `intent` 重放冻结 source Trace 中的原始输入与观察点
6. 记录 expected、actual、状态、Trace、日志和 artifact 引用
7. 按 test-engineer、code-quality、security、runtime-e2e、debugging-recovery lens 合并判断
8. Agent harness 证据区分 Durable Session、Working Trace、Provider Transcript 三层
9. 返回唯一 Reviewer v1 JSON；同一次 DAG 不回跳 EngineerCat

## 普通 Case Artifact

非定时 DAG 任务若指定 `review.md` 或 `reviewer-output.json`：

- `review.md` 可写中文回放说明、lens 判断和残余风险
- `reviewer-output.json` 必须仍使用同一个 version 1 `status/evidence_refs` 合同
- 不创建第二套机器状态或兼容字段

## 收尾检查

- Replay Case 只有 `id / intent / expected_outcome / source_trace_refs` 四个合同字段
- 输出只有 `version / status / summary / evidence_refs / reason?`
- `closed` 与 `next_run` 有本轮 fresh evidence
- `blocked` 有明确 reason
- 定时 DAG 没有调用任意命令 runner，也没有修改生产代码
- 同一次 DAG 没有 ReviewerCat → EngineerCat 回跳
