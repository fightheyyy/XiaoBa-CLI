# XiaoBa Live Agent Eval

`eval/` 只放 live agent eval benchmark。

Live agent eval 的意思是：

```text
用户请求 + 初始环境
-> 重新跑当前 agent/runtime
-> 产生新的 trace / tool calls / delivery / artifacts
-> 评测行为、结果、安全边界和恢复能力
```

当前保留：

- `LIVE_AGENT_EVAL.md`
- `SPEC.md`
- `PLAN.md`
- `benchmarks/BaseRuntime/`

当前不保留：

- contracts
- rubrics
- schemas
- historical trace regression
- static JSONL fixture benchmark
- observability regression candidate
- role static smoke

历史 trace replay 不放在 `eval/`。它使用独立入口：

```bash
npm run replay:trace -- --trace logs/sessions/.../traces.jsonl
xiaoba replay --trace logs/sessions/.../traces.jsonl
```

## Run

```bash
npm run eval:base-runtime
npm run eval:gate
```

Support preflight：

```bash
npm run check:benchmarks
```

`test/` 是工程测试边界，不属于 `eval/`。`check:benchmarks` 是 manifest/case/suite 预检，也不是 eval。
