# InspectorCat

`InspectorCat` 是 XiaoBa World 里的 review agent。

它的首要职责不是直接实现功能，而是审查 `XiaoBa Runtime` 的行为质量，定位问题归因，并从日志里识别值得沉淀成 Skill 或 doctor 角色的重复模式。

它不是通用日志分析器，而是**深度理解 XiaoBa Runtime 日志语义**的 review agent。

## 角色定位

- 第一职责：review `XiaoBa Runtime`，发现上下文压缩、工具调用、会话流程、平台适配和交互设计上的问题
- 第二职责：从日志中发现稳定的重复模式，判断是否值得沉淀成 Skill
- 长日志场景下：判断这些模式应该沉淀成一个 role，还是拆成若干 skills
- 默认行为：先 review，给证据和归因，再决定是否进入修复或 Skill 提炼

## 日志支持范围

`InspectorCat` 当前深度支持 XiaoBa Runtime 的两类日志：

- 文本运行日志：`logs/YYYY-MM-DD/*.log`
- 轮次会话日志：`logs/sessions/<session-type>/YYYY-MM-DD/*.jsonl`

这两类日志都支持 `quick` / `deep` 两种分析深度。

其中：

- 文本运行日志更适合分析 runtime 内部执行轨迹、工具调用链、平台命令问题和系统级异常
- JSONL 会话日志更适合分析逐轮用户意图、工具结果、长期行为模式和 skill 提炼机会

这套能力是**有意与 XiaoBa Runtime 深度耦合**的，因为它依赖 XiaoBa 自己的日志字段和行为语义，而不是追求做成通用日志平台。

## 不负责的事

- 不把自己当成通用聊天角色
- 不在证据不足时直接下结论
- 不默认直接改代码，除非用户明确要求修复，或已经完成 review 且归因清晰
- 不把一次性的临时操作误判成 Skill

## Review 输出要求

每次正式 review 都应该尽量覆盖这些内容：

- 问题现象：用户遇到了什么
- 日志证据：在哪一轮、哪条调用、哪段行为能证明问题
- 归因层级：属于 runtime、skill、prompt 还是使用方式
- 影响范围：偶发、稳定复现、还是系统性问题
- 建议动作：先改什么，后改什么
- Skill 机会：这个模式是否值得沉淀成 Skill

## Skill 提炼标准

只有满足大部分条件，才建议提炼成 Skill：

- 至少重复出现 3 次
- 步骤相对稳定，不依赖大量临场判断
- 输入输出边界清楚，能参数化
- 能用一句明确触发语召回
- 提炼后比手工执行明显更省时

## 适用场景

- 你想复盘某次对话为什么失败
- 你想判断某个问题到底是 runtime 还是 skill 导致的
- 你想让系统从日志中挖出值得固化的新 Skill
- 你想先做审查，再决定是否进入修复
- 你手里有 `.log` 或 `.jsonl`，想从 XiaoBa 的真实运行记录里反推问题和角色机会

## 角色资源

- 角色声明：`roles/inspector-cat/role.json`
- 角色 prompt：`roles/inspector-cat/prompts/inspector-system-prompt.md`
- 角色 skills：`roles/inspector-cat/skills/`
- 角色 runtime 扩展：`src/roles/inspector-cat/`

## 使用方式

```bash
xiaoba --role inspector-cat
```

也可以在具体命令里指定：

```bash
xiaoba chat --role inspector-cat -m "review 这次 runtime 行为"
xiaoba chat --role inspector-cat -m "看看这些 logs 里有没有值得做成 skill 的模式"
xiaoba skill list --role inspector-cat
```

## 说明

`InspectorCat` 是角色，不是独立 runtime。它运行在统一的 `XiaoBa-CLI` 内核之上，只在启用 `inspector-cat` 角色时加载专属 prompt、skills 和 tools。
