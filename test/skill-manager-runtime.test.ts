import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import { SkillManager } from '../src/skills/skill-manager';
import { ToolManager } from '../src/tools/tool-manager';
import { createSubAgentToolExecutor } from '../src/core/sub-agent-session';
import { SpawnSubagentTool } from '../src/tools/spawn-subagent-tool';
import { ToolExecutionOutput } from '../src/types/tool';

describe('SkillManager runtime base skills', () => {
  test('base runtime excludes OfficeCLI and sub-agent skill wrappers', async () => {
    const manager = new SkillManager();
    await manager.loadSkills();

    const names = manager.getAllSkills().map(skill => skill.metadata.name).sort();

    assert.deepStrictEqual(names, [
      'agent-browser',
      'background-task-runner',
      'remember',
      'role-publish',
      'self-evolution',
      'skill-publish',
      'vision-analysis',
      'webcli',
    ]);
    assert.strictEqual(manager.getSkill('officecli-docx'), undefined);
    assert.strictEqual(manager.getSkill('officecli-pptx'), undefined);
    assert.strictEqual(manager.getSkill('officecli-xlsx'), undefined);
    assert.strictEqual(manager.getSkill('sub-agent'), undefined);

    const fallback = manager.getSkill('background-task-runner');
    assert.ok(fallback, 'background-task-runner should be available for spawn_subagent fallback use');
    assert.strictEqual(fallback.metadata.userInvocable, false);
    assert.strictEqual(fallback.metadata.autoInvocable, false);
    assert.strictEqual(manager.getSkill('general-background-task')?.metadata.name, 'background-task-runner');
  });

  test('sub-agent capabilities are default runtime tools', () => {
    const manager = new ToolManager();

    for (const toolName of [
      'spawn_subagent',
      'check_subagent',
      'stop_subagent',
      'resume_subagent',
      'ask_parent',
    ]) {
      assert.ok(manager.getTool(toolName), `${toolName} should be registered as a runtime tool`);
    }
  });

  test('spawn_subagent accepts either role_name or skill_name', async () => {
    const tool = new SpawnSubagentTool();
    const parameters = tool.definition.parameters as any;

    assert.ok(parameters.properties.role_name);
    assert.deepStrictEqual(parameters.required, ['task_description', 'user_message']);
    assert.equal(parameters.type, 'object');
    for (const forbiddenTopLevelKeyword of ['anyOf', 'oneOf', 'allOf', 'not', 'enum']) {
      assert.equal(
        parameters[forbiddenTopLevelKeyword],
        undefined,
        `spawn_subagent parameters should remain OpenAI-compatible without top-level ${forbiddenTopLevelKeyword}`,
      );
    }

    const missingDispatchTarget = await tool.execute(
      {
        task_description: 'missing dispatch target smoke',
        user_message: 'run missing dispatch target smoke',
      },
      {
        workingDirectory: process.cwd(),
        sessionId: 'subagent-schema-test',
      },
    );
    assertStructuredToolFailure(missingDispatchTarget, 'INVALID_TOOL_ARGUMENTS', /role_name 和 skill_name 至少填写一个/);

    const ambiguousDispatchTarget = await tool.execute(
      {
        skill_name: 'background-task-runner',
        task_description: 'ambiguous dispatch target smoke',
        user_message: 'run ambiguous dispatch target smoke',
        role_name: 'reviewer-cat',
      },
      {
        workingDirectory: process.cwd(),
        sessionId: 'subagent-schema-test',
      },
    );
    assertStructuredToolFailure(ambiguousDispatchTarget, 'INVALID_TOOL_ARGUMENTS', /role_name 和 skill_name 只能二选一/);

    const invalidRoleResult = await tool.execute(
      {
        task_description: 'invalid explicit role smoke',
        user_message: 'run invalid explicit role smoke',
        role_name: 'not-a-real-role',
      },
      {
        workingDirectory: process.cwd(),
        sessionId: 'subagent-schema-test',
      },
    );

    assertStructuredToolFailure(invalidRoleResult, 'ROLE_NOT_FOUND', /未找到 role_name "not-a-real-role"/);

    const baseRoleOnlyResult = await tool.execute(
      {
        task_description: 'base role-only smoke',
        user_message: 'run base role-only smoke',
        role_name: 'none',
      },
      {
        workingDirectory: process.cwd(),
        sessionId: 'subagent-schema-test',
      },
    );
    assertStructuredToolFailure(baseRoleOnlyResult, 'INVALID_TOOL_ARGUMENTS', /请改为只填 skill_name/);
  });

  test('default runtime tool schemas keep provider-compatible object roots', () => {
    const manager = new ToolManager();

    for (const definition of manager.getToolDefinitions()) {
      const parameters = definition.parameters as any;
      assert.equal(parameters.type, 'object', `${definition.name} parameters should use object root`);
      for (const forbiddenTopLevelKeyword of ['anyOf', 'oneOf', 'allOf', 'not', 'enum']) {
        assert.equal(
          parameters[forbiddenTopLevelKeyword],
          undefined,
          `${definition.name} parameters should not use top-level ${forbiddenTopLevelKeyword}`,
        );
      }
    }
  });

  test('sub-agents inherit role-specific runtime tools without main-session control tools', () => {
    const engineerTools = createSubAgentToolExecutor(process.cwd(), 'test-engineer', 'engineer-cat');
    const engineerToolNames = engineerTools.getToolDefinitions().map(tool => tool.name);
    assert.ok(engineerToolNames.includes('engineer_task_run'));
    assert.ok(engineerToolNames.includes('codex_job_status'));
    assert.ok(engineerToolNames.includes('ask_parent'));
    for (const hiddenTool of [
      'spawn_subagent',
      'check_subagent',
      'stop_subagent',
      'resume_subagent',
      'skill',
      'send_text',
      'send_file',
    ]) {
      assert.strictEqual(engineerToolNames.includes(hiddenTool), false, `${hiddenTool} should be hidden inside sub-agents`);
    }

    const inspectorTools = createSubAgentToolExecutor(process.cwd(), 'test-inspector', 'inspector-cat');
    const inspectorToolNames = inspectorTools.getToolDefinitions().map(tool => tool.name);
    assert.ok(inspectorToolNames.includes('analyze_log'));
    assert.strictEqual(inspectorToolNames.includes('run_pending_log_batch'), false);

    const reviewerTools = createSubAgentToolExecutor(process.cwd(), 'test-reviewer', 'reviewer');
    const reviewerToolNames = reviewerTools.getToolDefinitions().map(tool => tool.name);
    assert.ok(reviewerToolNames.includes('reviewer_eval_prepare'));
    assert.ok(reviewerToolNames.includes('reviewer_xiaoba_cli_e2e'));
    assert.strictEqual(reviewerToolNames.includes('spawn_subagent'), false);
  });

  test('role-only sub-agents can use skill tool to choose role-local skills', () => {
    const reviewerTools = createSubAgentToolExecutor(
      process.cwd(),
      'test-reviewer-role-only',
      'reviewer',
      { allowSkillTool: true },
    );
    const reviewerToolNames = reviewerTools.getToolDefinitions().map(tool => tool.name);

    assert.ok(reviewerToolNames.includes('skill'));
    assert.ok(reviewerToolNames.includes('reviewer_eval_prepare'));
    for (const hiddenTool of ['spawn_subagent', 'check_subagent', 'send_text', 'send_file']) {
      assert.strictEqual(reviewerToolNames.includes(hiddenTool), false, `${hiddenTool} should stay hidden`);
    }
  });
});

function assertStructuredToolFailure(
  output: ToolExecutionOutput,
  errorCode: string,
  contentPattern: RegExp,
): void {
  assert.strictEqual(output.status, 'failure');
  assert.strictEqual(output.error_code, errorCode);
  assert.strictEqual(output.retryable, false);
  assert.match(String(output.toolContent), contentPattern);
}
