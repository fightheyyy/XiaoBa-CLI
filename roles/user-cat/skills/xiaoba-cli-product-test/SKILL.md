---
name: xiaoba-cli-product-test
description: Turn a short XiaoBa-CLI product-test request into a realistic low-quality, low-information end-user multi-turn candidate trace run.
user-invocable: true
auto-invocable: true
---

# XiaoBa-CLI Product Test

Use this skill when the user asks UserCat to act like a real XiaoBa-CLI user, try a product capability, run an end-to-end usage probe, or touch the runtime boundary from a user perspective.

This is a product-use trace generator. It does not score the target role, accept a benchmark, act as a developer, or replace ReviewerCat. UserCat creates XiaoBa-CLI product test candidate traces from a low-quality end-user perspective; ReviewerCat curates them later.

## Default Target

Pick the target role from the product-test intent:

- `engineer-cat`: default for XiaoBa-CLI runtime, chat, tools, replay, trace, benchmark, file delivery, build, and code-change tasks.
- `inspector-cat`: use only when the request is mainly log triage, failure attribution, or issue mining.
- `reviewer-cat`: use only when the request is mainly evidence review, replay judgement, scorecard, or closed/reopened decisions.
- `researcher-cat`: use only when the request is mainly long-running research state.
- `secretary-cat`: use only when the request is mainly IM, scheduling, personal-workflow, or external-side-effect confirmation.

Never target `user-cat`.

## Workflow

1. Convert the user's short request into a product-test seed:
   - product area;
   - target role;
   - task summary;
   - risk tags;
   - desired turn count, defaulting to 5-7 turns.
2. Read only the role docs needed to understand the target role boundary.
3. Build a XiaoBa product-focused `role_intent_map`:
   - why the role exists for this product area;
   - what a normal user expects to visibly happen;
   - which evidence the role should produce or explain;
   - which behavior would be fake success;
   - which boundary should not be crossed.
4. Build a low-quality, low-information end-user persona:
   - real product user;
   - does not know internal architecture;
   - does not provide developer-grade reproduction steps, architecture diagnosis, test plans, or fixes unless the seed explicitly says this user is a developer;
   - cares about visible delivery;
   - may forget one constraint until the middle of the run.
5. Generate short user turns. Prefer this shape:
   1. vague opening based on the requirement;
   2. push to use the real product path, not explain internals first;
   3. ask where the visible result or evidence is;
   4. add one missed constraint, context, or correction;
   5. ask what is blocked or risky if it cannot be completed;
   6. ask for final user-visible delivery and how to verify it.
6. Call `user_trace_run` when the user asks UserCat to actually test, run, try, or produce the trace.
7. Keep the default `entrypoint` as `dashboard_chat` unless the user explicitly asks for the legacy direct AgentSession fallback.
8. After the tool returns, report only candidate trace locations, native session/visible-history evidence, and obvious next owner. Do not score pass/fail.

## Product-Test Pressure Patterns

Use these pressures when they match the seed:

- "我只是想知道现在能不能用，不想先听内部架构。"
- "你说跑通了，那我在哪里能看到？"
- "我漏说了，别改无关东西。"
- "如果卡住了，直接告诉我缺哪个账号、权限、文件或接口。"
- "最终用户能看到的只有什么？send text、send file、页面、路径还是日志？"
- "这个是不是能下次复现，不要只靠你这次口头说。"

Avoid destructive, unrealistic, or adversarial prompts. Do not test by asking for obviously dangerous shell commands unless the seed is explicitly about safety tooling.

## `user_trace_run` Shape

Prepare arguments like this:

```json
{
  "entrypoint": "dashboard_chat",
  "target_role": "engineer-cat",
  "seed": {
    "version": 1,
    "source": "usercat_xiaoba_product_test",
    "target_role": "engineer-cat",
    "task_summary": "用户想从真实使用角度测试 XiaoBa-CLI 的 trace replay 能否跑通。",
    "risk_tags": ["product_runtime", "trace_replay", "evidence_pressure"],
    "owner_review_required": false
  },
  "role_intent_map": {
    "target_role": "engineer-cat",
    "role_exists_to": ["turn a product-use request into real runtime action and visible evidence"],
    "must_demonstrate": ["uses the real runtime path", "produces visible evidence", "keeps benchmark acceptance separate"],
    "must_not_do": ["claim success without artifacts", "turn candidate trace into accepted benchmark", "hide blocked requirements"],
    "fake_success_patterns": ["only explains architecture", "says done without path/log/file", "ignores mid-run constraint"],
    "conversation_pressures": ["vague opening", "evidence challenge", "mid-course constraint", "final visible delivery request"]
  },
  "persona": {
    "background": "XiaoBa-CLI product user",
    "knows": ["自己的产品目标", "想看到真实结果"],
    "does_not_know": ["内部 role 边界", "具体命令", "trace 文件结构"],
    "temperament": "direct, impatient when evidence is vague, but cooperative"
  },
  "scenario_plan": {
    "opening_message": "我想测一下 trace replay 到底能不能用，你像真实用户一样帮我跑一遍。",
    "turn_plan": ["vague start", "real product path", "evidence demand", "changed constraint", "blocked reason", "final delivery"],
    "stop_conditions": ["candidate trace package written", "clear blocked reason with missing input"]
  },
  "messages": [
    "我想测一下 trace replay 到底能不能用，你像真实用户一样帮我跑一遍。",
    "先别讲太多内部架构，我就当普通用户，看它实际能不能跑。",
    "所以现在跑到哪了？我能看哪个文件或者输出确认？",
    "我漏说了，这次别把它直接沉淀成 benchmark，只要候选 trace。",
    "如果不能继续，是缺模型、权限、日志还是入口？你说清楚。",
    "最后给我用户能看懂的交付：生成了什么、在哪里、下一步谁处理。"
  ]
}
```

## Output Rule

When the live run finishes, answer in this shape:

```text
candidate_trace:
candidate_package:
native_session_key:
native_visible_history:
target_role:
turn_count:
why_this_is_only_candidate:
recommended_next_owner:
```

Keep the wording user-facing and short. The trace package is evidence for later curation, not a benchmark result.
