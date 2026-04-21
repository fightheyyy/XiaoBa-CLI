---
name: runtime-doctor
description: 诊断并修复 XiaoBa Runtime 的设计缺陷和 bug
version: 1.0.0
author: InspectorCat Team
user_invocable: true
invocable: both
argument-hint: "<问题描述或日志路径>"
max-turns: 40
---

# Runtime Doctor

从用户日志中发现 XiaoBa Runtime 的设计缺陷，复现 bug，编写测试，修复代码。

## 核心理念

**督察猫的自举能力**：
- 督察猫基于 XiaoBa Runtime 二次开发（只新增 Skills + Tools）
- 继承了所有基础工具（read, edit, grep, execute_shell）
- 可以读取、修改、测试 Runtime 的 TypeScript 代码
- **用自己修自己** — 发现问题 → 定位代码 → 修复 → 测试 → 提交

## 触发条件

- "修复 Runtime 问题"
- "诊断 Runtime bug"
- "这个问题是 Runtime 层面的"
- analyze_log 发现 Runtime 缺陷时自动建议触发

## 硬规则

1. **必须先复现 bug** — 不能凭猜测修改代码
2. **必须写测试** — 验证修复有效且不引入新问题
3. **模块化测试** — 只测试修改的模块，不跑全量测试
4. **小步提交** — 一个 bug 一个 commit，不批量修改
5. **保留日志证据** — 记录从哪个用户日志发现的问题

## 执行流程

### Step 1: 识别 Runtime 问题

从 `analyze_log` 的结果中识别 Runtime 层面的问题（不是 Skill 问题）：

**Runtime 问题特征**：
- 系统级错误（超时、崩溃、环境问题）
- 工具执行异常（subagent 失败、文件操作错误）
- 用户中断未响应
- 性能问题（重复操作、无缓存）
- 平台适配问题（飞书/微信/CLI 行为不一致）

**示例**：
```
从日志发现的 Runtime 问题：

1. subagent 用系统 ssh 超时，主会话用 paramiko 成功
   → 问题：subagent 执行环境配置不一致
   → 影响：Windows 下 subagent 无法执行需要密码认证的 ssh

2. 用户发 kill 指令后，AI 继续执行 40+ 轮
   → 问题：用户中断信号未正确处理
   → 影响：用户体验差，浪费 token

3. 反复用 find /share 扫描超时
   → 问题：工具缺少超时保护和结果缓存
   → 影响：卡住会话，用户等待时间长
```

### Step 2: 定位问题代码

使用 `grep` 和 `read` 定位相关代码：

**定位策略**：
1. 根据问题类型确定搜索范围：
   - subagent 问题 → `src/tools/spawn-subagent-tool.ts`, `src/agent/`
   - 工具执行问题 → `src/tools/`
   - 会话管理问题 → `src/session/`, `src/conversation/`
   - 平台适配问题 → `src/platforms/`

2. 搜索关键词：
   - 错误信息中的关键字
   - 工具名称
   - 日志中出现的函数名

3. 读取相关文件，理解逻辑

**示例**：
```bash
# 定位 subagent ssh 问题
grep -r "spawn.*subagent" src/tools/
grep -r "execute_shell" src/tools/spawn-subagent-tool.ts

# 定位用户中断处理
grep -r "kill\|interrupt\|abort" src/session/
grep -r "AbortSignal" src/
```

### Step 3: 复现 bug

**关键**：必须能稳定复现，才能验证修复有效。

**复现方式**：
1. **编写最小复现用例**（单元测试）
2. **不依赖真实环境**（mock 外部依赖）
3. **快速执行**（< 5 秒）

**示例**：创建 `tests/runtime-doctor/subagent-ssh-bug.test.ts`

```typescript
import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import { SpawnSubagentTool } from '../../src/tools/spawn-subagent-tool';

describe('Bug: subagent ssh 超时', () => {
  test('应该使用 paramiko 而不是系统 ssh', async () => {
    const tool = new SpawnSubagentTool();
    
    // 模拟 Windows 环境
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    
    const result = await tool.execute({
      task: 'ssh 连接服务器',
      tools: ['execute_shell']
    }, { workingDirectory: process.cwd() });
    
    // 验证：应该检测到 paramiko 可用并优先使用
    assert.ok(!result.includes('timeout'), '不应该超时');
    
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });
});
```

**运行复现测试**：
```bash
npx tsx --test tests/runtime-doctor/subagent-ssh-bug.test.ts
```

预期：测试失败（复现了 bug）

### Step 4: 分析根因

AI 分析代码逻辑，找出根本原因：

**分析维度**：
- 代码逻辑是否有漏洞
- 是否缺少错误处理
- 是否缺少边界条件检查
- 是否有环境依赖问题
- 是否有性能问题

**示例分析**：
```
问题：subagent ssh 超时

根因分析：
1. 读取 src/tools/spawn-subagent-tool.ts
2. 发现 subagent 使用 execute_shell 执行 ssh 命令
3. execute_shell 在 Windows 下调用系统 ssh.exe
4. 系统 ssh 无法在非交互式环境下处理密码认证
5. 主会话使用 paramiko（Python 库），可以传递密码

根本原因：
- subagent 没有检测 paramiko 是否可用
- 没有优先使用 paramiko 而是直接用系统 ssh
- 缺少 Windows 平台的特殊处理
```

### Step 5: 生成修复方案

AI 设计修复方案，包含：
1. 修改哪些文件
2. 具体改什么（代码 diff）
3. 为什么这样改
4. 可能的副作用

**示例修复方案**：
```typescript
文件：src/tools/spawn-subagent-tool.ts

修改：在 execute 方法开头添加环境检测

// 修改前
async execute(args: any, context: ToolExecutionContext) {
  const { task, tools } = args;
  // 直接创建 subagent
}

// 修改后
async execute(args: any, context: ToolExecutionContext) {
  const { task, tools } = args;
  
  // 检测 paramiko 是否可用（Windows 下优先使用）
  if (process.platform === 'win32' && tools.includes('execute_shell')) {
    const hasPython = await this.checkPythonAvailable();
    const hasParamiko = hasPython && await this.checkParamikoInstalled();
    
    if (hasParamiko) {
      // 注入环境变量，让 subagent 优先使用 paramiko
      context.env = { ...context.env, PREFER_PARAMIKO: 'true' };
    }
  }
  
  // 创建 subagent
}
```

### Step 6: 应用修复

使用 `edit_file` 修改代码：

```typescript
edit_file({
  file_path: "src/tools/spawn-subagent-tool.ts",
  old_string: "async execute(args: any, context: ToolExecutionContext) {\n  const { task, tools } = args;",
  new_string: "async execute(args: any, context: ToolExecutionContext) {\n  const { task, tools } = args;\n  \n  // 检测 paramiko 是否可用（Windows 下优先使用）\n  if (process.platform === 'win32' && tools.includes('execute_shell')) {\n    const hasPython = await this.checkPythonAvailable();\n    const hasParamiko = hasPython && await this.checkParamikoInstalled();\n    \n    if (hasParamiko) {\n      context.env = { ...context.env, PREFER_PARAMIKO: 'true' };\n    }\n  }"
})
```

### Step 7: 编写验证测试

修改 Step 3 的复现测试，验证修复有效：

```typescript
describe('Fix: subagent ssh 超时', () => {
  test('修复后应该优先使用 paramiko', async () => {
    const tool = new SpawnSubagentTool();
    
    Object.defineProperty(process, 'platform', { value: 'win32' });
    
    const result = await tool.execute({
      task: 'ssh 连接服务器',
      tools: ['execute_shell']
    }, { workingDirectory: process.cwd() });
    
    // 验证：不应该超时，且使用了 paramiko
    assert.ok(!result.includes('timeout'), '修复后不应该超时');
    assert.ok(result.includes('paramiko') || !result.includes('ssh.exe'),
      '应该使用 paramiko 而不是系统 ssh');
  });
});
```

**运行测试**：
```bash
npx tsx --test tests/runtime-doctor/subagent-ssh-bug.test.ts
```

预期：测试通过（bug 已修复）

### Step 8: 模块化测试

只测试修改的模块，不跑全量测试（节省时间）：

```bash
# 只测试 subagent 相关
npx tsx --test tests/**/spawn-subagent*.test.ts

# 如果有相关的集成测试
npx tsx --test tests/integration/subagent*.test.ts
```

如果测试失败，回到 Step 5 调整修复方案。

### Step 9: 提交改动

生成清晰的 commit message：

```bash
git add src/tools/spawn-subagent-tool.ts tests/runtime-doctor/subagent-ssh-bug.test.ts
git commit -m "fix(subagent): Windows 下优先使用 paramiko 执行 ssh

问题：
- subagent 在 Windows 下使用系统 ssh.exe 执行密码认证超时
- 主会话使用 paramiko 可以成功

根因：
- subagent 没有检测 paramiko 可用性
- 没有针对 Windows 平台特殊处理

修复：
- 在 Windows 下检测 paramiko 是否安装
- 如果可用，注入环境变量让 subagent 优先使用
- 添加复现测试和验证测试

来源：用户日志 logs/2026-04-09/10-22-58_catscompany.log
影响：Windows 用户的 subagent ssh 操作成功率提升"
```

### Step 10: 生成修复报告

向用户报告修复结果：

```markdown
✅ Runtime Bug 已修复

**问题**：subagent 在 Windows 下 ssh 超时

**根因**：没有优先使用 paramiko

**修复**：
- 文件：src/tools/spawn-subagent-tool.ts
- 改动：添加 paramiko 检测和优先使用逻辑
- 测试：已通过

**影响**：
- Windows 用户的 subagent ssh 操作成功率提升
- 不影响其他平台

**Commit**: 6a3f8e2 fix(subagent): Windows 下优先使用 paramiko

**来源日志**: logs/2026-04-09/10-22-58_catscompany.log
```

## 注意事项

### 安全原则

1. **只修改明确有问题的代码** — 不做"顺便优化"
2. **保持向后兼容** — 不破坏现有功能
3. **小步迭代** — 一次只修一个 bug
4. **充分测试** — 必须有测试覆盖

### 何时不修复

以下情况不应该修复，而是报告给开发者：

- 需要重构大量代码
- 涉及架构变更
- 不确定副作用
- 缺少测试覆盖的核心模块

这些情况下，生成详细的问题报告和修复建议，但不直接修改代码。

### 测试策略

- **单元测试**：测试单个函数/类
- **集成测试**：测试模块间交互
- **不跑 E2E 测试**：太慢，留给 CI

### Commit 规范

遵循 Conventional Commits：

```
fix(scope): 简短描述

问题：
- 具体问题描述

根因：
- 根本原因

修复：
- 修改内容

来源：日志路径
影响：影响范围
```

## 与其他 Skill 的配合

- **log-review**: 发现 Runtime 问题后，建议调用 runtime-doctor
- **skill-evolution**: 如果问题是 Skill 层面的，不要用 runtime-doctor
- **self-evolution**: 修复完成后，可以用 self-evolution 记录经验

## 输出格式

```
🔧 Runtime Doctor 诊断报告

问题识别：
- [问题1描述]
- [问题2描述]

代码定位：
- src/tools/xxx.ts:123
- src/session/yyy.ts:456

复现测试：
✅ 已复现（tests/runtime-doctor/xxx.test.ts）

修复方案：
- [修改文件1]：[改动说明]
- [修改文件2]：[改动说明]

验证测试：
✅ 测试通过（8/8）

提交记录：
- 6a3f8e2 fix(subagent): Windows 下优先使用 paramiko

影响评估：
- 受益用户：Windows 用户
- 风险：低（只影响 Windows 平台）
```
