# Session Log 转工作日志方案

## 一、当前 Session Log 现状分析

### 1.1 日志存储结构
```
logs/sessions/
├── catscompany/    # CatsCompany 平台
│   ├── 2026-04-06/
│   │   ├── cc_group_grp_35.jsonl    (47 turns)
│   │   ├── cc_user_usr2.jsonl       (2 turns)
│   │   └── ...
├── chat/           # CLI 聊天模式
├── cli/            # CLI 命令模式
└── weixin/         # 微信平台
```

### 1.2 日志格式（JSONL）
每行一个 JSON 对象，包含：
```json
{
  "turn": 1,
  "timestamp": "2026-04-06T04:16:12.895Z",
  "session_id": "cc_group:grp_35",
  "session_type": "catscompany",
  "user": {
    "text": "用户说的话"
  },
  "assistant": {
    "text": "AI 回复的文本（可能为空）",
    "tool_calls": [
      {
        "id": "tooluse_xxx",
        "name": "read_file",
        "arguments": "{...}",
        "result": "工具执行结果"
      }
    ]
  },
  "tokens": {
    "prompt": 1149,
    "completion": 31
  }
}
```

### 1.3 日志内容特点
- **用户意图**：user.text 包含用户的需求和问题
- **AI 操作**：assistant.tool_calls 记录了 AI 调用的工具和参数
- **执行结果**：tool_calls[].result 包含工具执行的输出
- **AI 回复**：assistant.text 是 AI 给用户的文字回复
- **调试信息**：result 中可能包含大量系统日志（如 `[DEBUG]`、`ℹ`、`✓`）

### 1.4 噪音数据
- 系统调试日志（`[DEBUG]`、`ℹ`、`✓`、`✗`）
- 工具执行的详细输出（如 shell 命令的完整输出）
- Token 统计信息
- 上下文管理信息
- 重复的状态通知

---

## 二、转换目标：工作日志/日记

### 2.1 目标格式
生成自然语言的工作日记，包含：
1. **日期和会话概览**
2. **主要任务和目标**
3. **完成的工作**
4. **遇到的问题**
5. **解决方案**
6. **关键决策**
7. **待办事项**

### 2.2 示例输出
```markdown
# 2026-04-06 工作日志

## 会话：cc_group:grp_35 (47 轮对话)

### 任务目标
用户需要整理"分析截图3.png"的内容并转换为 Markdown 格式。

### 工作过程
1. **查找文件**：尝试使用 glob 和 shell 命令查找截图文件
   - 问题：未在当前目录找到"分析截图3.png"
   - 发现：找到了 `tmp/downloads/1775282325410_小八截图.png`

2. **读取图片**：使用 read_file 工具读取图片
   - 遇到问题：`message.content.map is not a function` 错误
   - 原因分析：read_file 返回的特殊对象作为 tool result 流入消息历史，导致类型错误

3. **问题定位**：
   - 定位到 token-estimator.ts 和 context-compressor.ts 没有做类型检查
   - 根本原因：图片 base64 应该作为 user content 发送，而不是 tool result

4. **解决方案**：
   - 方案A（防御式）：在 token-estimator 加类型检查
   - 方案B（架构式）：在 conversation-runner 构建消息时转换结构
   - 决定采用方案B，更符合架构设计

### 关键决策
- 选择方案B：在消息历史构建阶段就规范化结构，而不是在多处做防御性检查
- 修改步骤：conversation-runner → anthropic-provider → 防御性修复

### 待办事项
- [ ] 实施方案B的三个步骤
- [ ] 测试图片读取功能
- [ ] 验证不同 provider 的兼容性

---

## 会话：cc_user:usr2 (2 轮对话)

### 讨论内容
1. **Agent 辅助单元测试**：提出让 agent 针对局部修改写测试文件，避免每次整体编译
2. **生物信息项目落地**：计划将合作项目的工作流程 CLI 化，作为"Agent 即 OS"的实战案例
```

---

## 三、转换方案设计

### 3.1 数据清洗层
**目标**：过滤噪音，提取有效信息

**清洗规则**：
1. **过滤调试日志**：
   - 删除 `[DEBUG]`、`ℹ`、`✓`、`✗` 开头的行
   - 删除 token 统计信息
   - 删除上下文管理信息

2. **简化工具输出**：
   - shell 命令：只保留命令本身和关键输出（前5行+后5行）
   - 文件读取：只保留文件路径和大小，不保留完整内容
   - glob/grep：只保留匹配的文件列表

3. **提取关键信息**：
   - 用户意图：user.text
   - AI 操作：tool_calls[].name + arguments（简化）
   - 执行结果：result（简化）
   - AI 回复：assistant.text

### 3.2 语义理解层
**目标**：理解对话的语义和上下文

**分析维度**：
1. **任务识别**：
   - 从第一轮对话提取主要任务
   - 识别子任务和步骤

2. **问题识别**：
   - 检测错误信息（error、failed、问题）
   - 提取问题描述

3. **解决方案识别**：
   - 识别尝试的方案
   - 提取最终采用的方案

4. **决策识别**：
   - 识别选择性问题（"方案A还是方案B"）
   - 提取决策结果

### 3.3 生成层
**目标**：生成自然语言的工作日志

**生成策略**：
1. **使用 LLM 生成**：
   - 输入：清洗后的 session log
   - Prompt：指导 LLM 生成工作日志格式
   - 输出：Markdown 格式的日记

2. **Prompt 设计**：
```
你是一个工作日志助手。根据以下对话记录，生成一份工作日志。

要求：
1. 用第一人称（"我"）叙述
2. 突出主要任务、遇到的问题、解决方案、关键决策
3. 忽略技术细节和调试信息
4. 用自然语言，不要列举工具调用
5. 格式：Markdown，包含任务目标、工作过程、关键决策、待办事项

对话记录：
{cleaned_log}
```

---

## 四、实施方案

### 4.1 脚本架构
```
scripts/
├── log-to-diary.js          # 主脚本
├── lib/
│   ├── log-cleaner.js       # 数据清洗
│   ├── log-analyzer.js      # 语义分析
│   └── diary-generator.js   # 日志生成
```

### 4.2 主流程
```javascript
// 1. 读取指定日期的所有 session log
const sessions = readSessionLogs(date, platform);

// 2. 对每个 session 进行清洗
const cleanedSessions = sessions.map(session => cleanLog(session));

// 3. 对每个 session 进行语义分析
const analyzedSessions = cleanedSessions.map(session => analyzeLog(session));

// 4. 使用 LLM 生成工作日志
const diary = await generateDiary(analyzedSessions, date);

// 5. 保存到文件
saveDiary(diary, `logs/diaries/${date}-diary.md`);
```

### 4.3 清洗函数示例
```javascript
function cleanLog(session) {
  return session.map(turn => {
    // 清洗 user.text
    const userText = turn.user.text
      .split('\n')
      .filter(line => !line.match(/^\[DEBUG\]|^ℹ|^✓|^✗/))
      .join('\n');

    // 简化 tool_calls
    const toolCalls = turn.assistant.tool_calls?.map(tc => ({
      name: tc.name,
      arguments: simplifyArguments(tc.arguments),
      result: simplifyResult(tc.result, tc.name)
    }));

    return {
      turn: turn.turn,
      timestamp: turn.timestamp,
      user: { text: userText },
      assistant: {
        text: turn.assistant.text,
        tool_calls: toolCalls
      }
    };
  });
}

function simplifyResult(result, toolName) {
  if (toolName === 'execute_shell') {
    // 只保留命令和前5行输出
    const lines = result.split('\n');
    return lines.slice(0, 6).join('\n') + (lines.length > 6 ? '\n...' : '');
  }
  if (toolName === 'read_file') {
    // 只保留文件路径和大小
    const match = result.match(/文件: (.+)\n.*大小: (.+)/);
    return match ? `已读取: ${match[1]} (${match[2]})` : result.slice(0, 100);
  }
  return result.slice(0, 200); // 默认截断
}
```

### 4.4 生成函数示例
```javascript
async function generateDiary(analyzedSessions, date) {
  const prompt = `你是一个工作日志助手。根据以下对话记录，生成一份工作日志。

要求：
1. 用第一人称（"我"）叙述
2. 突出主要任务、遇到的问题、解决方案、关键决策
3. 忽略技术细节和调试信息
4. 用自然语言，不要列举工具调用
5. 格式：Markdown，包含任务目标、工作过程、关键决策、待办事项

日期：${date}

${analyzedSessions.map(session => `
## 会话：${session.session_id} (${session.turns.length} 轮对话)

${JSON.stringify(session.turns, null, 2)}
`).join('\n---\n')}

请生成工作日志：`;

  const response = await aiService.chat([
    { role: 'user', content: prompt }
  ]);

  return response.content;
}
```

---

## 五、优化方向

### 5.1 增量生成
- 每次对话结束后自动生成当前 session 的日志片段
- 每日结束时汇总所有 session 生成完整日志

### 5.2 多级摘要
- Session 级别：每个会话的摘要
- 日级别：每天的工作总结
- 周级别：每周的进展回顾

### 5.3 关键词提取
- 自动提取技术关键词（如"图片读取"、"类型错误"）
- 生成标签云

### 5.4 趋势分析
- 统计每天的工作时长
- 分析工具使用频率
- 识别常见问题模式

---

## 六、实施步骤

### Phase 1：基础脚本（1-2天）
- [ ] 实现 log-cleaner.js（数据清洗）
- [ ] 实现 log-to-diary.js 主流程
- [ ] 测试单个 session 的转换

### Phase 2：LLM 生成（1天）
- [ ] 实现 diary-generator.js
- [ ] 调优 prompt
- [ ] 测试生成质量

### Phase 3：批量处理（0.5天）
- [ ] 支持批量处理多个日期
- [ ] 支持多平台（catscompany/chat/cli）
- [ ] 生成汇总报告

### Phase 4：自动化（0.5天）
- [ ] 集成到 xiaoba 启动流程
- [ ] 每日自动生成
- [ ] Dashboard 展示

---

## 七、预期效果

### 输入
- 原始 session log：47 轮对话，包含大量调试信息和工具输出

### 输出
- 工作日志：1-2页 Markdown，清晰描述任务、问题、解决方案
- 可读性：非技术人员也能理解
- 可检索：按日期、关键词、任务类型检索

### 价值
1. **个人回顾**：快速回忆当天做了什么
2. **团队协作**：分享工作进展和遇到的问题
3. **知识沉淀**：积累解决方案和最佳实践
4. **绩效评估**：量化工作产出和时间分配
