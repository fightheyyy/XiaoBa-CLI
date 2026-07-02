---
name: trace-simulation
description: Produce low-quality, low-information end-user pressure scenarios and candidate trace packages for target role evaluation.
user-invocable: true
auto-invocable: true
---

# Trace Simulation

Use this skill when the user asks UserCat to create, shape, simulate, or run realistic user traces for a target XiaoBa role.

## Purpose

Generate candidate trace data from a low-quality end-user perspective, not benchmark decisions. The output is useful only when it preserves the separation:

```text
UserCat creates candidate trace data.
ReviewerCat curates and judges evidence.
Benchmark harness owns fixture, verifier, replay, baseline, and release gates.
```

`user_trace_run` is the UserCat runtime tool for live target-role dialogue. In adaptive mode it sends the opening user message through the native Dashboard Chat/Pet entrypoint, reads the target role's visible reply, then decides the next low-information user message before continuing. Product traces and visible history land in the normal pet/chat locations; it does not judge the result.

## Workflow

1. Establish the seed:
   - `target_role`
   - seed source
   - task summary
   - risk tags
   - privacy review requirement
2. Read the target role contract:
   - `roles/<target-role>/SPEC.md`
   - `roles/<target-role>/PLAN.md`
   - `roles/<target-role>/README.md`
   - `roles/<target-role>/prompts/*`
   - relevant eval or benchmark evidence when available
3. Write the role intent map before scenario design.
4. Design a low-quality, low-information end-user persona.
5. Design a 3-6 turn adaptive scenario:
   - vague opening;
   - one evidence challenge;
   - one missing detail or changed constraint;
   - one boundary or side-effect question;
   - a stop condition.
6. Produce an opening user turn plus fallback pressures for adaptive live dialogue.
7. If the user asks to run the trace for real, call `user_trace_run` with:
   - default `entrypoint: dashboard_chat`
   - default `interaction_mode: adaptive` for Arena / live exploration
   - `target_role`
   - `seed`
   - `role_intent_map`
   - `persona`
   - `scenario_plan`
   - `messages` as opening / fallback user pressures
8. Produce candidate case metadata:
   - capability tags;
   - expected artifacts;
   - verifier candidates;
   - replay readiness;
   - known gaps.
9. Produce a trace-quality self-check.

## Quality Bar

A good candidate trace:

- comes from a real seed, failure log, eval gap, or explicit manual template;
- tests the target role's reason to exist;
- uses natural short user turns;
- is under-specified at the start;
- avoids developer-grade reproduction steps, architecture diagnosis, test plans, or fixes unless the seed explicitly requires a developer persona;
- includes at least one evidence demand;
- includes at least one misunderstanding, missing detail, or mid-course constraint;
- creates observable behavior, artifact, blocked reason, or failure;
- stays local until privacy review.

Reject or mark weak traces that:

- are single-turn prompts;
- are too helpful or too technical;
- ask the target role to do everything perfectly in one message;
- have no possible verifier;
- contain private data that cannot be sanitized;
- let UserCat decide pass/fail.

## Output Template

```text
target_role:
seed:
risk_tags:
privacy_review_required:

role_intent_map:
- role_exists_to:
- user_pain:
- must_demonstrate:
- must_not_do:
- fake_success_patterns:
- conversation_pressures:

persona:
- background:
- knows:
- does_not_know:
- temperament:

scenario_plan:
- opening_message:
- turn_plan:
- stop_conditions:

candidate_user_turns:
1.
2.
3.

candidate_case_metadata:
- capability_tags:
- expected_artifacts:
- verifier_candidates:
- replay_readiness:
- known_gaps:

trace_quality_self_check:
- covers_role_intent:
- realistic_low_information_user:
- multi_turn_pressure:
- observable_behavior:
- privacy_safe:
- worth_reviewer_curation:

recommended_next_owner:
```
