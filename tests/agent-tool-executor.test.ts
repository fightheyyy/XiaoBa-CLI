import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import { AgentToolExecutor } from '../src/agents/agent-tool-executor';
import { Tool, ToolCall, ToolExecutionContext } from '../src/types/tool';

function createToolCall(name: string, args: string = '{}'): ToolCall {
  return {
    id: 'call-1',
    type: 'function',
    function: {
      name,
      arguments: args,
    },
  };
}

function createTool(
  name: string,
  execute: Tool['execute'],
  controlMode?: 'pause_turn',
): Tool {
  return {
    definition: {
      name,
      description: `${name} tool`,
      parameters: {
        type: 'object',
        properties: {},
      },
      ...(controlMode ? { controlMode } : {}),
    },
    execute,
  };
}

describe('AgentToolExecutor', () => {
  test('returns tool definitions from wrapped tools', () => {
    const executor = new AgentToolExecutor([
      createTool('alpha', async () => 'ok'),
      createTool('beta', async () => 'ok'),
    ], '/workspace');

    assert.deepStrictEqual(
      executor.getToolDefinitions().map(tool => tool.name),
      ['alpha', 'beta'],
    );
  });

  test('normalizes Claude-style shell aliases and merges execution context', async () => {
    let receivedArgs: unknown;
    let receivedContext: ToolExecutionContext | undefined;
    const executor = new AgentToolExecutor([
      createTool('execute_shell', async (args, context) => {
        receivedArgs = args;
        receivedContext = context;
        return `ran ${(args as { command: string }).command}`;
      }),
    ], '/repo', {
      sessionId: 'base-session',
      surface: 'agent',
    });

    const result = await executor.executeTool(
      createToolCall('Bash', JSON.stringify({ command: 'pwd' })),
      [{ role: 'user', content: 'hello' }],
      { sessionId: 'override-session', activeSkillName: 'demo-skill' },
    );

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.name, 'Bash');
    assert.strictEqual(result.content, 'ran pwd');
    assert.deepStrictEqual(receivedArgs, { command: 'pwd' });
    assert.strictEqual(receivedContext?.workingDirectory, '/repo');
    assert.strictEqual(receivedContext?.sessionId, 'override-session');
    assert.strictEqual(receivedContext?.surface, 'agent');
    assert.strictEqual(receivedContext?.activeSkillName, 'demo-skill');
    assert.deepStrictEqual(receivedContext?.conversationHistory, [{ role: 'user', content: 'hello' }]);
  });

  test('reports missing tools without throwing', async () => {
    const executor = new AgentToolExecutor([], '/repo');

    const result = await executor.executeTool(createToolCall('missing_tool'));

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.errorCode, 'TOOL_NOT_FOUND');
    assert.strictEqual(result.retryable, false);
    assert.match(String(result.content), /missing_tool/);
  });

  test('reports invalid JSON arguments before executing the tool', async () => {
    let called = false;
    const executor = new AgentToolExecutor([
      createTool('demo', async () => {
        called = true;
        return 'should not run';
      }),
    ], '/repo');

    const result = await executor.executeTool(createToolCall('demo', '{bad json'));

    assert.strictEqual(called, false);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.errorCode, 'INVALID_TOOL_ARGUMENTS');
    assert.strictEqual(result.retryable, false);
  });

  test('wraps tool exceptions as non-retryable execution errors', async () => {
    const executor = new AgentToolExecutor([
      createTool('explode', async () => {
        throw new Error('boom');
      }),
    ], '/repo');

    const result = await executor.executeTool(createToolCall('explode'));

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.errorCode, 'TOOL_EXECUTION_ERROR');
    assert.strictEqual(result.retryable, false);
    assert.match(String(result.content), /boom/);
  });

  test('propagates pause_turn control mode on success', async () => {
    const executor = new AgentToolExecutor([
      createTool('pause', async () => 'paused', 'pause_turn'),
    ], '/repo');

    const result = await executor.executeTool(createToolCall('pause'));

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.controlSignal, 'pause_turn');
  });
});
