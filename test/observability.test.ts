import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentSession } from '../src/core/agent-session';
import { ConversationRunner } from '../src/core/conversation-runner';
import { SubAgentSession } from '../src/core/sub-agent-session';
import { ToolManager } from '../src/tools/tool-manager';
import {
  Observability,
  resetObservabilityForTests,
} from '../src/observability';
import type { ChatResponse, Message, Skill } from '../src/types';
import type { ToolCall, ToolDefinition, ToolExecutionContext, ToolExecutor, ToolResult } from '../src/types/tool';

describe('Local observability', () => {
  test('is disabled by default and omits prompt/tool args by default', () => {
    const observability = Observability.fromEnv({} as NodeJS.ProcessEnv);
    assert.equal(observability.isEnabled(), false);

    const prompt = '/Users/guowei/project token=secret-token-1234567890';
    const promptAttrs = observability.userInputAttributes(prompt);
    assert.equal(promptAttrs['xiaoba.user_input.chars'], prompt.length);
    assert.equal(promptAttrs['xiaoba.user_input.preview'], undefined);

    const toolArgs = '{"file":"/Users/guowei/private.txt","api_key":"sk-abcdefghijklmnopqrstuvwxyz"}';
    const toolAttrs = observability.toolArgumentAttributes(toolArgs);
    assert.equal(toolAttrs['xiaoba.tool.arguments.preview'], undefined);
    assert.equal(toolAttrs['xiaoba.tool.arguments.chars'], toolArgs.length);
  });

  test('preserves explicit prompt and tool argument previews in local raw mode', () => {
    const observability = Observability.fromEnv({
      XIAOBA_OBSERVABILITY_LOG_PROMPTS: 'true',
      XIAOBA_OBSERVABILITY_LOG_TOOL_ARGS: 'true',
    } as NodeJS.ProcessEnv);

    const prompt = '/Users/guowei/project 192.168.1.20 token=secret-token-1234567890';
    const promptAttrs = observability.userInputAttributes(prompt);
    const promptPreview = String(promptAttrs['xiaoba.user_input.preview']);
    assert.equal(promptPreview, prompt);

    const toolArgs = '{"file":"/Users/guowei/private.txt","api_key":"sk-abcdefghijklmnopqrstuvwxyz"}';
    const toolAttrs = observability.toolArgumentAttributes(toolArgs);
    const toolPreview = String(toolAttrs['xiaoba.tool.arguments.preview']);
    assert.equal(toolPreview, toolArgs);
  });

  test('keeps local SLO summary in local-only mode', () => {
    const observability = Observability.fromEnv({} as NodeJS.ProcessEnv);
    observability.recordMetric('xiaoba.tool.result', 1, {
      'xiaoba.role.name': 'engineer-cat',
      'xiaoba.skill.name': 'case-implementation',
      'xiaoba.surface': 'dashboard',
      'xiaoba.tool.name': 'edit_file',
      'xiaoba.tool.status': 'success',
      'xiaoba.tool.arguments.preview': '/Users/guowei/project token=secret-token-1234567890',
      'xiaoba.file.content': 'raw file token=secret-token-1234567890',
    });
    observability.recordMetric('xiaoba.tool.duration_ms', 120, {
      'xiaoba.role.name': 'engineer-cat',
      'xiaoba.skill.name': 'case-implementation',
      'xiaoba.surface': 'dashboard',
      'xiaoba.tool.name': 'edit_file',
      'xiaoba.tool.status': 'success',
    }, 'ms');
    observability.recordMetric('xiaoba.model.call', 1, {
      'xiaoba.role.name': 'engineer-cat',
      'xiaoba.model.status': 'error',
      'xiaoba.error_code': 'PROVIDER_AUTH_ERROR',
      'xiaoba.user_input.preview': 'api_key=sk-abcdefghijklmnopqrstuvwxyz',
    });

    const summary = observability.getLocalSummary();
    assert.equal(observability.isEnabled(), false);
    assert.equal(summary.external.enabled, false);
    assert.equal(summary.local.enabled, true);
    assert.equal(summary.totals.toolResults, 1);
    assert.equal(summary.slo.toolSuccessRate, 1);
    assert.equal(summary.slo.modelErrorRate, 1);
    assert.equal(summary.slo.byRole[0].name, 'engineer-cat');
    assert.equal(summary.slo.byRole[0].successRate, 0.5);
    assert.equal(summary.slo.byRole[0].errorRate, 0.5);
    assert.equal(summary.slo.byRole[0].latency.p95Ms, 120);
    assert.equal(summary.slo.bySkill[0].name, 'case-implementation');
    assert.equal(summary.slo.bySkill[0].successRate, 1);
    assert.equal(summary.slo.byTool[0].name, 'edit_file');
    assert.equal(summary.slo.byTool[0].successRate, 1);
    assert.equal(summary.slo.bySurface[0].name, 'dashboard');
    assert.equal(summary.slo.bySurface[0].successRate, 1);
    assert.equal(summary.latency.tool.p95Ms, 120);
    assert.equal(summary.top.roles[0].name, 'engineer-cat');
    assert.equal(summary.top.skills[0].name, 'case-implementation');
    assert.equal(summary.top.tools[0].name, 'edit_file');

    const serialized = JSON.stringify(summary);
    assert.match(serialized, /guowei/);
    assert.match(serialized, /secret-token-1234567890/);
    assert.match(serialized, /sk-abcdefghijklmnopqrstuvwxyz/);
    assert.match(serialized, /\/Users\/guowei/);
    assert.match(serialized, /user_input\.preview|arguments\.preview/);
    assert.match(serialized, /raw file/);
  });

  test('exposes local drilldown facts with raw local attributes', () => {
    const observability = Observability.fromEnv({} as NodeJS.ProcessEnv);
    observability.recordMetric('xiaoba.tool.result', 1, {
      'xiaoba.role.name': 'engineer-cat',
      'xiaoba.surface': 'dashboard',
      'xiaoba.tool.name': 'execute_shell',
      'xiaoba.tool.status': 'blocked',
      'xiaoba.error_code': 'COMMAND_DENIED',
      'xiaoba.blocked_reason': 'requires_approval',
      'xiaoba.tool.arguments.preview': '{"cmd":"cat /Users/guowei/.ssh/id_rsa"}',
    });
    observability.recordMetric('xiaoba.provider.error', 1, {
      'xiaoba.role.name': 'engineer-cat',
      'xiaoba.provider.name': 'openai',
      'xiaoba.model.status': 'error',
      'xiaoba.error_code': 'PROVIDER_RATE_LIMIT',
      'xiaoba.user_input.preview': 'api_key=sk-abcdefghijklmnopqrstuvwxyz',
    });

    const summary = observability.getLocalSummary();
    assert.equal(summary.totals.errors, 2);
    assert.equal(summary.totals.blocked, 1);
    assert.equal(summary.drilldown.recentErrors.length, 2);
    assert.equal(summary.drilldown.recentErrors[0].name, 'xiaoba.provider.error');
    assert.equal(summary.drilldown.blockedReasons[0].name, 'requires_approval');
    assert.deepEqual(summary.drilldown.policyDecisions, []);

    const serialized = JSON.stringify(summary.drilldown);
    assert.match(serialized, /guowei/);
    assert.match(serialized, /id_rsa/);
    assert.match(serialized, /sk-abcdefghijklmnopqrstuvwxyz/);
    assert.match(serialized, /arguments\.preview|user_input\.preview/);
  });

  test('exposes local trace timeline with raw local attributes and hashed trace identifiers', () => {
    const observability = Observability.fromEnv({} as NodeJS.ProcessEnv);
    const parentSpan = observability.startSpan('xiaoba.session', {
      'xiaoba.role.name': 'engineer-cat',
      'xiaoba.surface': 'dashboard',
      'xiaoba.trace.parent_propagated': true,
      'xiaoba.user_input.preview': '/Users/guowei/private prompt token=secret-token-1234567890',
    });
    const toolSpan = observability.startSpan('xiaoba.tool.call', {
      'xiaoba.role.name': 'engineer-cat',
      'xiaoba.surface': 'dashboard',
      'xiaoba.tool.name': 'execute_shell',
      'xiaoba.tool.arguments.preview': '{"cmd":"cat /Users/guowei/private.txt"}',
    }, parentSpan.context);

    observability.endSpan(toolSpan, {
      status: 'ok',
      attributes: {
        'xiaoba.tool.status': 'success',
      },
    });
    observability.endSpan(parentSpan, {
      status: 'ok',
      attributes: {
        'xiaoba.session.status': 'success',
      },
    });

    const summary = observability.getLocalSummary();
    assert.equal(summary.traces.spanCount, 2);
    assert.equal(summary.traces.traceCount, 1);
    assert.equal(summary.traces.rawTraceparentExported, false);
    assert.equal(summary.traces.recent.length, 1);
    assert.equal(summary.traces.recent[0].spanCount, 2);
    assert.equal(summary.traces.recent[0].rootName, 'xiaoba.session');
    assert.match(summary.traces.recent[0].traceIdHash, /^[0-9a-f]{16}$/);

    const spans = summary.traces.recent[0].spans;
    const localParentSpan = spans.find(span => span.name === 'xiaoba.session');
    const localToolSpan = spans.find(span => span.name === 'xiaoba.tool.call');
    assert.ok(localParentSpan);
    assert.ok(localToolSpan);
    assert.equal(localToolSpan.parentSpanIdHash, localParentSpan.spanIdHash);
    assert.equal(localToolSpan.attributes['xiaoba.tool.name'], 'execute_shell');
    assert.equal(localToolSpan.attributes['xiaoba.tool.status'], 'success');
    assert.equal(localParentSpan.attributes['xiaoba.trace.parent_propagated'], true);

    const serialized = JSON.stringify(summary.traces);
    assert.doesNotMatch(serialized, new RegExp(parentSpan.context.traceId));
    assert.doesNotMatch(serialized, new RegExp(parentSpan.context.spanId));
    assert.doesNotMatch(serialized, /00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}/i);
    assert.match(serialized, /guowei/);
    assert.match(serialized, /private\.txt/);
    assert.match(serialized, /secret-token-1234567890/);
    assert.match(serialized, /arguments\.preview|user_input\.preview/);
  });

  test('can disable local dashboard summary', () => {
    const observability = Observability.fromEnv({
      XIAOBA_OBSERVABILITY_LOCAL_ENABLED: 'false',
    } as NodeJS.ProcessEnv);

    observability.recordMetric('xiaoba.tool.result', 1, {
      'xiaoba.tool.name': 'edit_file',
      'xiaoba.tool.status': 'success',
    });

    const summary = observability.getLocalSummary();
    assert.equal(summary.local.enabled, false);
    assert.equal(summary.local.eventCount, 0);
  });

  test('ConversationRunner emits model, tool, token, and delivery telemetry locally', async () => {
    const observability = Observability.fromEnv({} as NodeJS.ProcessEnv);
    resetObservabilityForTests(observability);
    try {
      const parentSpan = observability.startSpan('xiaoba.session', {
        'xiaoba.session.id_hash': observability.sessionIdHash('session-secret'),
      });
      const runner = new ConversationRunner(
        new ToolThenFinalAIService() as any,
        new DeliveryToolExecutor(),
        {
          stream: false,
          enableCompression: false,
          toolExecutionContext: {
            sessionId: 'session-secret',
            surface: 'cli',
            roleName: 'user-cat',
          },
          observabilityContext: parentSpan.context,
        },
      );

      const result = await runner.run([{ role: 'user', content: 'send it' }]);
      observability.endSpan(parentSpan, { status: 'ok' });
      await observability.shutdown();

      assert.equal(result.response, 'done');
      assert.equal(result.toolResults.length, 1);

      const summary = observability.getLocalSummary();
      const metricNames = summary.recent.map(item => item.name);
      const traceNames = summary.traces.recent.flatMap(trace => trace.spans.map(span => span.name));
      assert.ok(traceNames.includes('xiaoba.model.call'));
      assert.ok(traceNames.includes('xiaoba.tool.call'));
      assert.ok(metricNames.includes('xiaoba.model.call'));
      assert.ok(metricNames.includes('xiaoba.model.duration_ms'));
      assert.ok(metricNames.includes('xiaoba.tool.call'));
      assert.ok(metricNames.includes('xiaoba.tool.result'));
      assert.ok(metricNames.includes('xiaoba.tool.duration_ms'));
      assert.ok(metricNames.includes('xiaoba.delivery.evidence'));
      assert.ok(metricNames.includes('xiaoba.tokens.total'));

      const serialized = JSON.stringify(summary);
      assert.doesNotMatch(serialized, /session-secret/);
      assert.doesNotMatch(serialized, /\/Users\/guowei\/secret\.txt/);
      assert.doesNotMatch(serialized, /sk-abcdefghijklmnopqrstuvwxyz/);
    } finally {
      resetObservabilityForTests(undefined);
    }
  });

  test('SubAgentSession model span inherits parent trace context locally', async () => {
    const observability = Observability.fromEnv({} as NodeJS.ProcessEnv);
    resetObservabilityForTests(observability);
    try {
      const parentSpan = observability.startSpan('xiaoba.parent.subagent', {
        'xiaoba.session.id_hash': observability.sessionIdHash('parent-session'),
      });
      const session = new SubAgentSession(
        'sub-observability',
        new FinalAIService() as any,
        new ObservabilitySkillManager() as any,
        {
          skillName: observabilitySkill.metadata.name,
          taskDescription: 'trace context test',
          userMessage: 'complete without tools',
          workingDirectory: process.cwd(),
          observabilityContext: parentSpan.context,
        },
      );

      await session.run();
      observability.endSpan(parentSpan, { status: 'ok' });

      const spans = observability.getLocalSummary().traces.recent.flatMap(trace => trace.spans);
      const parent = spans.find(span => span.name === 'xiaoba.parent.subagent');
      const model = spans.find(span => span.name === 'xiaoba.model.call');
      assert.ok(parent);
      assert.ok(model);
      assert.equal(model.parentSpanIdHash, parent.spanIdHash);
    } finally {
      resetObservabilityForTests(undefined);
    }
  });

  test('AgentSession consumes incoming traceparent as session span parent context locally', async () => {
    const originalCwd = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-observability-agent-session-'));
    const observability = Observability.fromEnv({} as NodeJS.ProcessEnv);
    resetObservabilityForTests(observability);
    try {
      process.chdir(tempDir);
      const parentSpan = observability.startSpan('xiaoba.parent.surface', {
        'xiaoba.surface': 'dashboard',
      });
      const session = new AgentSession('pet:trace-agent', {
        aiService: new FinalAIService() as any,
        toolManager: new ToolManager(),
        skillManager: new ObservabilitySkillManager() as any,
      }, 'dashboard');

      const result = await session.handleMessage('trace me', {
        surface: 'dashboard',
        traceparent: observability.traceparent(parentSpan.context),
      });
      observability.endSpan(parentSpan, { status: 'ok' });

      assert.equal(result.text, '');
      assert.equal(result.visibleToUser, false);

      const spans = observability.getLocalSummary().traces.recent.flatMap(trace => trace.spans);
      const parent = spans.find(span => span.name === 'xiaoba.parent.surface');
      const sessionSpan = spans.find(span => span.name === 'xiaoba.session');
      assert.ok(parent);
      assert.ok(sessionSpan);
      assert.equal(sessionSpan.parentSpanIdHash, parent.spanIdHash);

      const serialized = JSON.stringify(observability.getLocalSummary().traces);
      assert.doesNotMatch(serialized, /trace-agent/);
      assert.doesNotMatch(serialized, /00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}/i);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
      resetObservabilityForTests(undefined);
    }
  });

  test('AgentSession marks session visible when channel delivery evidence exists', async () => {
    const originalCwd = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-observability-delivery-'));
    const observability = Observability.fromEnv({} as NodeJS.ProcessEnv);
    resetObservabilityForTests(observability);
    try {
      process.chdir(tempDir);
      const replies: string[] = [];
      const session = new AgentSession('pet:delivery-agent', {
        aiService: new SendTextThenFinalAIService() as any,
        toolManager: new ToolManager(),
        skillManager: new ObservabilitySkillManager() as any,
      }, 'dashboard');

      const result = await session.handleMessage('deliver visible output', {
        surface: 'dashboard',
        channel: {
          chatId: 'dashboard-chat',
          reply: async (_chatId, text) => {
            replies.push(text);
          },
          sendFile: async () => undefined,
        },
      });

      assert.equal(result.text, '');
      assert.equal(result.visibleToUser, true);
      assert.deepEqual(replies, ['DELIVERED_FROM_SEND_TEXT']);

      const spans = observability.getLocalSummary().traces.recent.flatMap(trace => trace.spans);
      const sessionSpan = spans.find(span => span.name === 'xiaoba.session');
      assert.ok(sessionSpan);
      assert.equal(sessionSpan.attributes['xiaoba.session.visible_to_user'], true);
      assert.equal(sessionSpan.attributes['xiaoba.session.final_response_visible'], false);

      const sessionCompleted = observability.getLocalSummary().recent.find(event =>
        event.name === 'xiaoba.session.completed'
        && event.attributes['xiaoba.session.id_hash'] === observability.sessionIdHash('pet:delivery-agent')
      );
      assert.ok(sessionCompleted);
      assert.equal(sessionCompleted.attributes['xiaoba.session.visible_to_user'], true);
      assert.equal(sessionCompleted.attributes['xiaoba.session.final_response_visible'], false);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
      resetObservabilityForTests(undefined);
    }
  });
});

class ToolThenFinalAIService {
  calls = 0;

  async chat(messages: Message[], _tools?: ToolDefinition[]): Promise<ChatResponse> {
    return this.chatStream(messages);
  }

  async chatStream(_messages: Message[]): Promise<ChatResponse> {
    this.calls += 1;
    if (this.calls === 1) {
      return {
        content: null,
        toolCalls: [{
          id: 'call-demo',
          type: 'function',
          function: {
            name: 'demo_delivery',
            arguments: JSON.stringify({
              path: '/Users/guowei/secret.txt',
              api_key: 'sk-abcdefghijklmnopqrstuvwxyz',
            }),
          },
        }],
        usage: { promptTokens: 10, completionTokens: 3, totalTokens: 13 },
      };
    }
    return {
      content: 'done',
      usage: { promptTokens: 8, completionTokens: 2, totalTokens: 10 },
    };
  }
}

class DeliveryToolExecutor implements ToolExecutor {
  getToolDefinitions(_contextOverrides?: Partial<ToolExecutionContext>): ToolDefinition[] {
    return [{
      name: 'demo_delivery',
      description: 'demo delivery',
      parameters: {
        type: 'object',
        properties: {},
      },
    }];
  }

  async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    return {
      tool_call_id: toolCall.id,
      role: 'tool',
      name: toolCall.function.name,
      content: 'delivered',
      status: 'success',
      ok: true,
      retryable: false,
      duration_ms: 7,
      delivery_evidence: [{
        delivery_id: 'delivery-1',
        surface: 'dashboard',
        delivery_type: 'text',
        status: 'delivered',
        timestamp: new Date(0).toISOString(),
        text_preview: 'delivered',
      }],
    };
  }
}

const observabilitySkill: Skill = {
  metadata: {
    name: 'observability-worker',
    description: 'Sub-agent observability test skill',
    maxTurns: 3,
  },
  content: 'Finish immediately.',
  filePath: 'test/fixtures/observability-worker/SKILL.md',
};

class ObservabilitySkillManager {
  async loadSkills(): Promise<void> {}

  getSkill(name: string): Skill | undefined {
    return name === observabilitySkill.metadata.name ? observabilitySkill : undefined;
  }

  getUserInvocableSkills(): Skill[] {
    return [observabilitySkill];
  }

  findAutoInvocableSkillByText(): undefined {
    return undefined;
  }
}

class FinalAIService {
  async chat(messages: Message[], tools?: ToolDefinition[]): Promise<ChatResponse> {
    return this.chatStream(messages, tools);
  }

  async chatStream(_messages: Message[], _tools?: ToolDefinition[]): Promise<ChatResponse> {
    return {
      content: 'subagent done',
      usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
    };
  }
}

class SendTextThenFinalAIService {
  private calls = 0;

  async chat(messages: Message[], tools?: ToolDefinition[]): Promise<ChatResponse> {
    return this.chatStream(messages, tools);
  }

  async chatStream(_messages: Message[], _tools?: ToolDefinition[]): Promise<ChatResponse> {
    this.calls += 1;
    if (this.calls === 1) {
      return {
        content: null,
        toolCalls: [{
          id: 'send-text-observability',
          type: 'function',
          function: {
            name: 'send_text',
            arguments: JSON.stringify({ text: 'DELIVERED_FROM_SEND_TEXT' }),
          },
        }],
        usage: { promptTokens: 10, completionTokens: 3, totalTokens: 13 },
      };
    }
    return {
      content: 'final text should stay hidden',
      usage: { promptTokens: 8, completionTokens: 2, totalTokens: 10 },
    };
  }
}
