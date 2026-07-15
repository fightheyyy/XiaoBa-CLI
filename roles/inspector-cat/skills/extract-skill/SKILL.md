---
name: extract-skill
description: 从日志中识别重复操作模式，生成证据化 Candidate Skill 草稿与 EvolutionCat handoff
version: 1.0.0
author: InspectorCat Team
user_invocable: true
invocable: both
argument-hint: "<日志文件路径>"
max-turns: 20
---

# Extract Skill

从 XiaoBa 使用日志中识别重复操作序列，只输出 Candidate Skill 草稿和证据化路由；不创建文件。

## 触发条件

- "从日志提炼 Skill"
- "这个日志能生成什么 Skill"
- "分析日志并提取重复模式"
- 用户上传日志并要求提炼 Skill

## 核心理念

用户重复做的事情 = 应该自动化的 Skill。通过分析对话日志，识别：
- 相同的工具调用序列（如：ssh → cd → read_file）
- 相似的用户意图表达（如："查看远程日志"、"看看服务器日志"）
- 高频出现的操作组合

## 硬规则

1. **必须先调用 analyze_log (deep 模式)** 获取结构化数据，不要直接读原始日志
2. **至少 3 次重复** 才考虑提炼成 Skill
3. **先排除 runtime 问题**。如果重复是由超时、限流、路径权限、平台命令不兼容等异常导致，不要误判成 Skill
4. **先排除已有 skill 问题**。如果根因是某个 skill 触发条件太宽、步骤缺失或调用错工具，先建议修 skill，不要直接新建 skill
5. **生成的 Skill 必须包含**：触发条件、工作流程、参数说明、使用示例
6. **最后输出 EvolutionCat handoff**，由 Base 派给 `evolution-cat` 使用 role-local `self-evolution` 创建 Skill；InspectorCat 不自己写文件

## 执行流程

### Step 1: 分析日志获取数据

使用 `analyze_log` 工具（deep 模式）解析日志：

```
analyze_log({
  log_source: "<用户提供的日志路径>",
  analysis_depth: "deep"
})
```

获取 `turns[]` 数组，每个 turn 包含：
- `userMessage`: 用户说了什么
- `aiResponse`: AI 回复了什么
- `tools[]`: 调用了哪些工具（name, params, result）

### Step 2: 识别重复模式

分析 `turns[]` 数据，寻找：

**工具序列模式**：
- 连续的工具调用组合（如：execute_shell → read_file → grep）
- 相同工具被重复调用（如：read_file 被调用 5 次读不同文件）

**意图模式**：
- 用户消息的语义相似性（如："查看日志"、"看看日志"、"读一下日志"）
- 目标相同但表达不同

**判断标准**：
- 至少出现 3 次
- 工具序列相似度 > 70%（工具名相同，参数类型相似）
- 或用户意图明确重复

### Step 2.5: 先做归因筛选

在生成 Skill 草稿前，先判断这个模式属于哪一类：

- **runtime 问题**：例如超时、429、网络失败、权限拦截、平台命令不兼容
- **已有 skill 问题**：例如触发词过宽、步骤漏掉、工具顺序不稳
- **新 skill 候选**：流程稳定、重复明显、输入输出边界清楚

只有第三类才进入新 Skill 提炼。

### Step 3: 生成 Skill 草稿

对每个识别到的模式，生成 Skill 定义草稿：

**Skill 命名**：
- 基于操作意图命名（如：remote-log-viewer, batch-file-processor）
- 使用小写字母、连字符

**Skill 内容结构**：
```markdown
---
name: <skill-name>
description: <一句话描述>
user_invocable: true
---

# <Skill 标题>

## 触发条件

<从用户消息中提取的触发短语>

## 工作流程

1. <步骤1：基于工具序列>
2. <步骤2>
3. ...

## 参数

<从工具调用参数中提炼>

## 使用示例

<基于实际日志中的用户消息>
```

### Step 4: 向用户展示草稿

将识别到的模式和生成的 Skill 草稿展示给用户：

```
发现 2 个重复模式：

1. **远程日志查看**（出现 5 次）
   - 操作序列：execute_shell(ssh) → execute_shell(cd) → read_file
   - 建议 Skill 名：remote-log-viewer
   
2. **批量文件处理**（出现 3 次）
   - 操作序列：glob → read_file(循环) → write_file
   - 建议 Skill 名：batch-file-processor

是否把这些候选交给 EvolutionCat？可以选择：
- 全部形成 handoff
- 只交付某几个（告诉我编号）
- 修改草稿后再交付
```

如果没有满足条件的候选，要明确说明原因，例如：

- 这是 runtime 问题，不是 Skill 机会
- 这是已有 skill 设计问题，应该先修 skill
- 重复次数不够
- 流程不稳定，暂时不适合沉淀

### Step 5: 交给 EvolutionCat 创建 Skill

用户确认后，为每个 Skill 输出结构化 handoff；普通会话由 Base 显式派给 `evolution-cat`，定时 DAG 由确定性 Route Gate 直接交付：

```
recommended_next_owner: evolution-cat
requested_skill: self-evolution
参数：
- 类型：skill
- 名称：<skill-name>
- 完整内容：<生成的 Skill 草稿>
```

EvolutionCat 的 role-local `self-evolution` 会负责创建目录、写入文件、验证。InspectorCat 不直接调用不可见的跨角色 Skill。

### Step 6: 报告 handoff

告知用户：
- 识别了哪些 Candidate Skill 草稿
- 每个草稿的触发条件、证据 refs 与泛化理由
- 下一 owner 是 EvolutionCat；InspectorCat 尚未创建任何文件

## 输出格式

**识别阶段**：
```
📊 日志分析完成

总轮次：45
发现 3 个重复模式：

1. 【高频】远程日志查看（5 次）
   序列：ssh连接 → 切换目录 → 读取文件
   
2. 【中频】批量文件处理（3 次）
   序列：查找文件 → 循环读取 → 写入结果
   
3. 【低频】数据库查询导出（3 次）
   序列：连接数据库 → 执行查询 → 导出CSV
```

**handoff 阶段**：
```
→ Candidate Skill handoff: remote-log-viewer
  next_owner: evolution-cat
  触发: "查看远程日志"、"ssh 看日志"
  
→ Candidate Skill handoff: batch-file-processor
  next_owner: evolution-cat
  触发: "批量处理文件"
```

## 注意事项

- 如果日志太短（< 5 轮），提示"日志数据不足，建议积累更多使用记录"
- 如果没有发现重复模式，说明用户操作多样化，暂不需要新 Skill
- 生成的 Skill 要足够通用，不要过度拟合单次日志
- 工具参数要抽象化（如：文件路径 → 参数化，不要硬编码）
- 如果模式复杂（> 5 步），考虑拆分成多个 Skill
- 如果一个模式主要由 runtime 异常触发出来，不要把异常流程包装成 Skill
- 如果一个模式本质上是已有 skill 的缺陷，先输出“修 skill”的建议，再考虑是否拆出新 skill

## 与其他 Skill 的配合

- **log-review**: 先用 log-review 发现问题，再用 extract-skill 提炼解决方案
- **EvolutionCat / self-evolution**: 普通会话可由 Base 显式派遣；夜间 DAG 则由 Inspector finding 经确定性 `evolution` route 交给 EvolutionCat 创建隔离 Candidate
- **Arena**: EvolutionCat 生成隔离 candidate 后，由独立 Arena 做多 case 评测
