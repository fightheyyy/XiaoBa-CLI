import { Tool, ToolDefinition, ToolExecutionContext } from '../../../types/tool';
import { SubAgentManager } from '../../../core/sub-agent-manager';
import { AIService } from '../../../utils/ai-service';
import { SkillManager } from '../../../skills/skill-manager';
import { AutoDevClient, AutoDevLogCardRecord, AutoDevLogDetail, AutoDevSessionLogSummary } from '../../../utils/autodev-client';
import { isAutoDevConfigured } from '../../../utils/autodev-config';
import { AutoDevInspectorWorker } from '../utils/autodev-inspector-worker';
import { getActiveAutoDevInspectorWorker } from '../utils/autodev-inspector-runtime';

export class InspectPendingLogsTool implements Tool {
  definition: ToolDefinition = {
    name: 'inspect_pending_logs',
    description: '审查 AutoDev 当前未处理的日志。适用于“分析一下现在 AutoDev 未处理的日志”“现在有哪些待审日志”“立即审查待处理日志”这类请求。',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: '本次最多处理几条待审日志，默认 3，最大 10。',
        },
      },
      required: [],
    },
  };

  async execute(args: any, context: ToolExecutionContext): Promise<string> {
    if (!isAutoDevConfigured()) {
      return '错误：AUTODEV_SERVER_URL 未配置';
    }

    const client = new AutoDevClient();
    const limit = this.normalizeLimit(args?.limit);
    const pending = await client.listPendingLogs('inspector', limit);
    if (pending.length === 0) {
      return 'AutoDev 当前没有待审日志。';
    }

    const worker = getActiveAutoDevInspectorWorker() || new AutoDevInspectorWorker({
      workingDirectory: context.workingDirectory,
      batchSize: limit,
    });

    const spawned = await this.trySpawnSubagent(limit, context);
    if (spawned) {
      return spawned;
    }

    void this.runInBackground(client, worker, pending, context);
    return [
      `已开始后台审查 ${Math.min(limit, pending.length)} 条 AutoDev 待处理日志。`,
      ...pending.slice(0, limit).map(log => this.formatLogRef(log)),
      '审查完成后我会再发一条结果摘要。',
    ].join('\n');
  }

  private normalizeLimit(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return 3;
    }
    return Math.max(1, Math.min(10, Math.floor(parsed)));
  }

  private formatPendingOnly(pending: AutoDevSessionLogSummary[]): string {
    const lines = [
      'Inspector 批处理已在运行中，先给你当前待审日志列表：',
      ...pending.map(log => this.formatLogRef(log)),
    ];
    return lines.join('\n');
  }

  private formatProcessed(logs: AutoDevSessionLogSummary[], details: AutoDevLogDetail[]): string {
    const lines = [`已审查 ${logs.length} 条 AutoDev 待处理日志：`];
    for (let index = 0; index < logs.length; index += 1) {
      const log = logs[index];
      const detail = details[index];
      const inspectorCard = this.pickInspectorCard(detail?.cards || []);
      const status = inspectorCard?.card_type === 'failure' ? '失败' : '已完成';
      const summary = inspectorCard?.summary
        || detail?.events?.find(event => event.agent === 'inspector')?.kind
        || '已回写结果到 AutoDev';
      lines.push(`- ${this.formatLogRef(log)} | ${status} | ${summary}`);
    }
    return lines.join('\n');
  }

  private formatLogRef(log: AutoDevSessionLogSummary): string {
    return `${log.log_id} | ${log.filename} | ${log.session_id} | ${log.uploaded_at || 'unknown'}`;
  }

  private pickInspectorCard(cards: AutoDevLogCardRecord[]): AutoDevLogCardRecord | undefined {
    const inspectorCards = cards.filter(card => card.agent === 'inspector');
    return inspectorCards.sort((a, b) => {
      const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
      const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
      return bTime - aTime;
    })[0];
  }

  private async runInBackground(
    client: AutoDevClient,
    worker: AutoDevInspectorWorker,
    pending: AutoDevSessionLogSummary[],
    context: ToolExecutionContext,
  ): Promise<void> {
    try {
      const result = await worker.runOnce();
      if (result.skipped) {
        await this.reply(context, this.formatPendingOnly(pending));
        return;
      }

      const processedCount = result.processed;
      const processedLogs = pending.slice(0, processedCount);
      if (processedLogs.length === 0) {
        await this.reply(context, 'Inspector 后台批处理已执行，但这次没有处理到待审日志。');
        return;
      }

      const details = await Promise.all(
        processedLogs.map(log => client.getLogDetail(log.log_id).catch(() => ({ log } as AutoDevLogDetail))),
      );
      await this.reply(context, this.formatProcessed(processedLogs, details));
    } catch (error: any) {
      await this.reply(context, `Inspector 后台批处理失败: ${String(error?.message || error)}`);
    }
  }

  private async reply(context: ToolExecutionContext, text: string): Promise<void> {
    if (!context.channel) {
      return;
    }
    await context.channel.reply(context.channel.chatId, text);
  }

  private async trySpawnSubagent(limit: number, context: ToolExecutionContext): Promise<string | null> {
    const sessionKey = String(context.sessionId || '').trim();
    if (!sessionKey || sessionKey.startsWith('subagent:')) {
      return null;
    }

    const skillManager = new SkillManager();
    await skillManager.loadSkills();
    const aiService = new AIService();
    const result = SubAgentManager.getInstance().spawn(
      sessionKey,
      'autodev-pending-review',
      `审查 AutoDev 待处理日志（limit=${limit}）`,
      `请调用 run_pending_log_batch，参数 limit=${limit}，并汇总结果。`,
      context.workingDirectory,
      aiService,
      skillManager,
    );

    if ('error' in result) {
      return null;
    }

    return [
      `已派发后台子任务 ${result.id} 审查 AutoDev 待处理日志。`,
      `状态: ${result.status}`,
      `任务: ${result.taskDescription}`,
      '完成后主会话会自动收到结果摘要。',
      '如果要手动查看进度，可以用 check_subagent。',
    ].join('\n');
  }
}
