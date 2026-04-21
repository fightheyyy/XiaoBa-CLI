import * as fs from 'fs';
import * as path from 'path';
import * as Lark from '@larksuiteoapi/node-sdk';
import { AgentSession, AgentServices } from '../../../core/agent-session';
import { MessageSessionManager } from '../../../core/message-session-manager';
import { MessageSender } from '../../../feishu/message-sender';
import { SkillManager } from '../../../skills/skill-manager';
import { ToolManager } from '../../../tools/tool-manager';
import { ChannelCallbacks } from '../../../types/tool';
import { AIService } from '../../../utils/ai-service';
import { Logger } from '../../../utils/logger';
import { InspectorCaseRecord } from './inspector-case-store';

export interface InspectorReviewDelivery {
  type: 'text' | 'file';
  text?: string;
  filePath?: string;
  fileName?: string;
}

export interface InspectorAgentReviewResult {
  generatedAt: string;
  caseId: string;
  mode: 'agent_review';
  summary: {
    overview: string;
    deliveryCount: number;
    reportGenerated: boolean;
  };
  reportFilePath?: string;
  finalText?: string;
  deliveries: InspectorReviewDelivery[];
  newMessages?: unknown[];
}

export interface InspectorReviewExecutor {
  reviewCase(record: InspectorCaseRecord, store: InspectorWorkspaceStore): Promise<InspectorAgentReviewResult>;
}

export interface InspectorWorkspaceStore {
  getCaseDir(caseId: string): string;
}

interface InspectorAgentReviewExecutorOptions {
  reportChatId?: string;
}

export class InspectorAgentReviewExecutor implements InspectorReviewExecutor {
  private readonly reportChatId: string;
  private readonly sender?: MessageSender;

  constructor(options: InspectorAgentReviewExecutorOptions = {}) {
    this.reportChatId = String(options.reportChatId || process.env.INSPECTOR_REPORT_FEISHU_CHAT_ID || '').trim();
    if (this.reportChatId) {
      const appId = String(process.env.FEISHU_APP_ID || '').trim();
      const appSecret = String(process.env.FEISHU_APP_SECRET || '').trim();
      if (!appId || !appSecret) {
        throw new Error('FEISHU_APP_ID / FEISHU_APP_SECRET 未配置，无法让督察猫会话主动发件');
      }

      const client = new Lark.Client({ appId, appSecret });
      this.sender = new MessageSender(client);
    }
  }

  async reviewCase(record: InspectorCaseRecord, store: InspectorWorkspaceStore): Promise<InspectorAgentReviewResult> {
    const caseDir = store.getCaseDir(record.caseId);
    const reportFilePath = path.join(caseDir, 'agent-review.md');
    const deliveries: InspectorReviewDelivery[] = [];
    const usesFeishuRelay = !!(this.reportChatId && this.sender);
    const channel = usesFeishuRelay
      ? this.createRelayChannel(deliveries)
      : undefined;

    const skillManager = new SkillManager();
    await skillManager.loadSkills();

    const services: AgentServices = {
      aiService: new AIService(),
      toolManager: new ToolManager(caseDir),
      skillManager,
    };

    const sessionKey = usesFeishuRelay
      ? `group:${this.reportChatId}:inspector-review:${record.caseId}`
      : `autodev-inspector:${record.caseId}`;
    const session = new AgentSession(sessionKey, services, usesFeishuRelay ? 'feishu' : 'chat');
    const attachmentList = record.files
      .filter(file => /\.(log|jsonl)$/i.test(file.path))
      .map(file => `- ${file.path} (${file.kind || 'unknown'})`)
      .join('\n');

    const taskMessage = [
      usesFeishuRelay
        ? '现在有一批日志材料被转交给你，请把它当作“有人把 logs 文件发给督察猫，请你亲自审查”。'
        : '现在有一批 AutoDev 待审日志，请你在本地工作目录里亲自完成审查，并写出报告。',
      '',
      '你的任务：',
      '1. 亲自审查全部附件日志，而不是只做上传成功确认。',
      '2. 必须优先调用 analyze_log 获取结构化证据，必要时再调用 skill 工具使用 log-review、log-to-skill、runtime-doctor 等技能。',
      '3. 如果样本偏薄，要明确指出“样本偏薄，不足以证明系统健康”，不能空泛地说没有问题。',
      '4. 除了审查报告，还必须额外写一个 AutoDev 交接文件，路径固定为当前 case 目录下的 autodev-handoff.json。',
      usesFeishuRelay
        ? '5. 把完整审查报告写入指定文件，再主动发送给当前群。'
        : '5. 把完整审查报告写入指定文件，并在最终回复里用 3-6 行摘要说明结论。',
      '',
      `报告文件必须写到: ${reportFilePath}`,
      `AutoDev 交接文件必须写到: ${path.join(caseDir, 'autodev-handoff.json')}`,
      'autodev-handoff.json 必须是 JSON，并至少包含这些字段：',
      '{',
      '  "version": 1,',
      '  "shouldCreateCase": true 或 false,',
      '  "title": "给 EngineerCat 的案件标题",',
      '  "category": "runtime_bug | new_skill_candidate | skill_fix | insufficient_signal",',
      '  "priority": "low | normal | high",',
      '  "recommendedNextAction": "runtime_fix | extract_skill | repair_skill | collect_more_signal",',
      '  "summary": "一句话总结主要问题",',
      '  "nextState": "fixing | blocked",',
      '  "evidenceSummary": {',
      '    "rootCauseHypothesis": "根因假设",',
      '    "confidence": "low | medium | high",',
      '    "signals": ["关键证据 1", "关键证据 2"]',
      '  },',
      '  "labels": ["runtime", "inspector"]',
      '}',
      '如果你判断暂时不该创建 AutoDev case，也必须写 shouldCreateCase=false，并说明为什么。',
      usesFeishuRelay
        ? `写完后必须调用 send_file 发送该文件，文件名固定为: inspector-review-${record.caseId}.md`
        : '不要调用 send_file 或 send_text；只需要保证报告文件落盘成功。',
      '然后给出一条 3-6 行摘要，内容要包括：用户在做什么、runtime 有没有问题、是否值得继续收集更长日志。',
      '如果没有明确问题，也要说明本次用户行为和样本是否足够。',
      '不要向用户反问，直接完成任务。',
      '',
      `案件信息：analysisType=${record.analysisType}，source=${record.source || 'unknown'}，userRequest=${record.userRequest || 'n/a'}`,
      '附件清单：',
      attachmentList || '- 无有效日志附件',
    ].join('\n');
    const mainSessionKey = usesFeishuRelay ? `group:${this.reportChatId}` : '';
    const mainSessionManager = usesFeishuRelay ? MessageSessionManager.getManager('feishu') : null;

    if (usesFeishuRelay) {
      Logger.info(`[InspectorHook] 把 case ${record.caseId} 转交给督察猫 session 审查`);
      mainSessionManager?.injectContext(
        mainSessionKey,
        [
          '[inspector_hook_task]',
          `caseId=${record.caseId}`,
          `caseDir=${caseDir}`,
          '有人转交了一批 logs 到上述目录，请督察猫审查用户行为、runtime 问题、skill/doctor 机会。',
        ].join('\n'),
        this.reportChatId,
      );
    } else {
      Logger.info(`[InspectorHook] 本地审查模式已启用: ${record.caseId}`);
    }

    try {
      const result = channel
        ? await session.handleMessage(taskMessage, { channel })
        : await session.handleMessage(taskMessage);
      await session.cleanup();

      const reportGenerated = fs.existsSync(reportFilePath);
      const overview = reportGenerated
        ? (usesFeishuRelay
          ? `督察猫已亲自完成审查并发出报告，共发送 ${deliveries.length} 条交付。`
          : `督察猫已在本地完成审查并生成报告。`)
        : (usesFeishuRelay
          ? `督察猫已执行审查会话，但没有生成报告文件；共发送 ${deliveries.length} 条交付。`
          : '督察猫已执行本地审查，但没有生成报告文件。');

      return {
        generatedAt: new Date().toISOString(),
        caseId: record.caseId,
        mode: 'agent_review',
        summary: {
          overview,
          deliveryCount: deliveries.length,
          reportGenerated,
        },
        reportFilePath: reportGenerated ? path.relative(caseDir, reportFilePath).replace(/\\/g, '/') : undefined,
        finalText: result.text,
        deliveries,
        newMessages: result.newMessages,
      };
    } catch (error) {
      await session.cleanup().catch(() => undefined);
      throw error;
    } finally {
      const injectedDeliveries = deliveries
        .map(delivery => {
          if (delivery.type === 'text' && delivery.text) {
            return delivery.text.trim();
          }
          if (delivery.type === 'file' && delivery.fileName) {
            return `[已发送文件] ${delivery.fileName}`;
          }
          return '';
        })
        .filter(Boolean);

      if (usesFeishuRelay && injectedDeliveries.length > 0) {
        mainSessionManager?.injectContext(
          mainSessionKey,
          [
            '[inspector_hook_result]',
            `caseId=${record.caseId}`,
            ...injectedDeliveries,
          ].join('\n'),
          this.reportChatId,
        );
      }
    }
  }

  private createRelayChannel(deliveries: InspectorReviewDelivery[]): ChannelCallbacks {
    return {
      chatId: this.reportChatId,
      reply: async (chatId, text) => {
        deliveries.push({ type: 'text', text });
        await this.sender!.reply(chatId, text);
      },
      sendFile: async (chatId, filePath, fileName) => {
        deliveries.push({ type: 'file', filePath, fileName });
        await this.sender!.sendFile(chatId, filePath, fileName);
      },
    };
  }
}

export function createInspectorReviewExecutorFromEnv(): InspectorReviewExecutor {
  return new InspectorAgentReviewExecutor();
}
