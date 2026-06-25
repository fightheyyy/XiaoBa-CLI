# InspectorCat

`InspectorCat` 是 XiaoBa 的生产级故障分诊、证据取证和路由角色。

它的首要职责不是修复，也不是验收，而是把混乱的日志、session JSONL、tool failure、role 行为异常和 eval/benchmark 失败转成可复查、可路由的 issue profile。

一句话：

```text
InspectorCat = 这事为什么坏了，证据在哪，该谁接？
```

## 角色定位

- 第一职责：从 XiaoBa Runtime 证据里发现问题并做归因
- 第二职责：生成下游角色可消费的 issue profile 和 handoff packet
- 第三职责：识别重复失败模式，判断是否需要 skill、benchmark 或 replay
- 默认行为：先取证、再归因、再路由；不默认修复，不默认关单

## 生产输出

正式分析应尽量产出两类材料：

- `agent-review.md`：给人看的审查报告
- `inspector-handoff.json`：给 EngineerCat / ReviewerCat / benchmark pipeline 消费的结构化交接包

`analyze_log` 会返回：

- `summary.signalQuality`
- `summary.recommendedIntakeAction`
- `issues[]`
- `issueProfiles[]`
- `toolStats[]`
- deep 模式下的 bounded `turns[]`

## 日志支持范围

`InspectorCat` 当前深度支持 XiaoBa Runtime 的两类日志：

- 文本运行日志：`logs/**/*.log`
- 轮次会话日志：`logs/sessions/**/*.jsonl`

这套能力有意与 XiaoBa Runtime 深度耦合。它依赖 XiaoBa 的 session、turn、tool call、tool result、surface delivery 和 runtime event 语义，不追求做成通用日志平台。

## 不负责的事

- 不把自己当成通用聊天角色
- 不在证据不足时直接下结论
- 不默认直接改代码
- 不决定 `closed / reopened / blocked`
- 不维护 Research Board
- 不把一次性的临时操作误判成 skill

## 路由边界

| 发现 | 下一步 |
| --- | --- |
| runtime / tool / surface bug | 交给 `engineer-cat` 修 |
| 是否能关单、是否真的可用 | 交给 `reviewer-cat` 验 |
| 科研状态或 claim/evidence 混乱 | 交给 `researcher-cat` |
| 样本太薄 | 标记 `insufficient_signal`，要求补日志 |
| 重复稳定流程 | 满足阈值后建议 skill extraction |
| runtime invariant regression | 建议 replay / benchmark case |

## 使用方式

```bash
xiaoba chat --role inspector-cat -m "分析这个 session JSONL 为什么工具调用断了"
xiaoba chat --role inspector-cat -m "看看这份 runtime.log 该交给谁处理"
xiaoba skill list --role inspector-cat
```

## 角色资源

- 角色声明：`roles/inspector-cat/role.json`
- 角色 prompt：`roles/inspector-cat/prompts/inspector-system-prompt.md`
- 角色 skills：`roles/inspector-cat/skills/`
- 角色 runtime 扩展：`src/roles/inspector-cat/`

`InspectorCat` 是角色，不是独立 runtime。它运行在统一的 `XiaoBa-CLI` 内核之上，只在启用 `inspector-cat` 角色时加载专属 prompt、skills 和 tools。
