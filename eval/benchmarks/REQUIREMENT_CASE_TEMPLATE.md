# Requirement-Driven Benchmark Case Template

状态：Active
最后更新：2026-06-04

本文定义 `eval/benchmarks/**/*.case.json` 或 benchmark JSONL 中 `lane: "requirement_acceptance"` 的 live agent eval 需求验收模板。目标是让“新需求是否完成”通过 fresh runtime replay、tool/result evidence 和 scorecard 证明，而不是靠静态 JSONL、schema gate 或历史日志推断。

## Contract

Requirement-driven benchmark case 必须仍然是普通 benchmark case，并额外带 `requirement` 对象：

```json
{
  "case_id": "base-runtime.example-feature",
  "name": "Example feature release gate mapping",
  "lane": "requirement_acceptance",
  "target_module": "skill",
  "risk_level": "release_blocking",
  "eval_suite": "suites/example-feature-live-replay.json",
  "eval_case_ids": [
    "example.feature.live-replay.001"
  ],
  "benchmark_case_kind": "live_surface_runtime_case",
  "raw_user_text_included": false,
  "case_category": "live_agent_eval_case",
  "target_role": "BaseRuntime",
  "replay_modes": ["surface_runtime_pet"],
  "task_prompt": "The user asks XiaoBa in an IM surface to use the example feature end to end and send evidence.",
  "verifier_ids": [
    "jsonl_parse",
    "tool_transcript_completeness",
    "tool_result_contract",
    "surface_runtime_e2e",
    "tool_sequence",
    "assistant_text_contains",
    "budget_check"
  ],
  "budgets": {
    "max_turns": 3,
    "max_tool_calls": 5,
    "max_tokens": 8000
  },
  "requirement": {
    "requirement_id": "REQ-EXAMPLE-FEATURE-001",
    "user_story": "As a XiaoBa user, I can use the example feature end to end and receive durable evidence.",
    "acceptance_criteria": [
      "The case enters through a live runtime replay instead of static fixture evidence.",
      "The runtime uses the expected tools and produces structured tool results.",
      "The expected artifact or delivery evidence is produced by this replay."
    ],
    "evidence": [
      "suites/example-feature-live-replay.json",
      "example.feature.live-replay.001"
    ],
    "owner": "Evaluation maintainers",
    "source": "eval/PLAN.md#live-agent-eval",
    "non_goals": [
      "This case does not store raw private user trace content."
    ]
  },
  "expected_decision": "pass",
  "failure_route": "skill"
}
```

## Field Rules

- `requirement_id`：稳定 ID，格式建议为 `REQ-<AREA>-<NNN>`。
- `user_story`：描述用户视角的完整需求，不写实现步骤。
- `acceptance_criteria`：至少一条，必须能映射到 hard verifier、required artifact、judge 或 human review。
- `evidence`：至少一条，必须引用映射的 `eval_suite` 和每个 `eval_case_ids`。
- `owner`：负责维护此需求验收合同的人或模块。
- `source`：需求来源、计划段落、issue、PR 或 spec anchor。
- `non_goals`：可选，用于明确这个 case 不证明什么，防止过度解释。

## Gate Rules

`npm run check:benchmarks` 会执行 live-only manifest 检查。它会拒绝没有 live metadata、没有 replay、只引用静态 JSONL、或 replay 不是 `surface_runtime` 的 benchmark case。

- 只有 `lane: "requirement_acceptance"` 的 case 可以携带 `requirement` contract。
- `requirement_id`、`user_story`、`acceptance_criteria` 和 `evidence` 必须非空。
- `requirement.evidence` 必须引用该 benchmark case 映射的全部 `eval_case_ids`。
