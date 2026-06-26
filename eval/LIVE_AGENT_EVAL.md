# Live Agent Eval Boundary

`eval/` 的唯一价值是 live agent eval benchmark。

一句话定义：

```text
把用户请求交给当前 agent/runtime 重新跑，
再评测它实际产生的 tool use、交付、artifact、恢复和安全边界。
```

## What Counts

一个 case 只有满足下面闭环，才配进入 `eval/`：

```text
input request
  + setup / workspace / session state
  -> current runtime replay
  -> fresh trace / tool calls / delivery / artifacts
  -> verifier / scorecard
```

必须能回答：

- 用户输入是什么？
- 初始环境是什么？
- 重新跑哪个 runtime/agent？
- 期望调用什么工具？
- 禁止调用什么工具？
- 最终应该交付什么文本、文件、artifact 或 blocked state？
- verifier 怎么用新产生的证据判定通过？

## What Does Not Count

这些东西有工程价值，但不能放在 `eval/`：

- unit / integration / contract smoke。
- schema / contract / source governance。
- static JSONL fixture check。
- historical trace regression。
- raw log catalog。
- rubric-only pack。
- observability summary 或 regression candidate。
- 只检查 manifest / source / generated output drift 的脚本。

它们应该属于 `test/`、`check:*`、Observability & Evidence，或 role/runtime 自己的 focused tests。

## Historical Trace Rule

真实 trace 可以先用 Trace Replay 复跑，但不能原样当 eval。

正确流程是：

```text
real trace
  -> trace replay 观察当前 runtime 是否复现同类行为
  -> 抽象出高价值用户任务
  -> 去隐私化 setup
  -> 写成 live replay case
  -> 加 expected tool/result/evidence
  -> 加 verifier
```

只有最后这个 live replay case 才能进入 `eval/`。

## Current Inventory

当前 `eval/` 只保留 BaseRuntime live agent eval：

- 11 个 benchmark cases。
- 11 个 nested eval cases。
- 全部通过 Pet/IM runtime replay 重新跑。
- 覆盖 coding patch、subagent goal、multi-turn evidence、explicit delivery、malformed tool recovery、dangerous command boundary、artifact lookup/resend、command recovery、path/env recovery、user correction/latest artifact、long-work status。

## Commands

```bash
npm run eval:base-runtime
npm run eval:gate
```

Support preflight：

```bash
npm run check:benchmarks
```

`check:benchmarks` 不是 eval，只检查 live benchmark manifest 和 case/suite 引用。
