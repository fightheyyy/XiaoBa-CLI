import { Tool, ToolDefinition, ToolExecutionContext } from '../../../types/tool';
import { AutoDevClient, AutoDevLogCardRecord, AutoDevLogDetail, AutoDevSessionLogSummary } from '../../../utils/autodev-client';
import { isAutoDevConfigured } from '../../../utils/autodev-config';
import { AutoDevInspectorWorker } from '../utils/autodev-inspector-worker';
import { getActiveAutoDevInspectorWorker } from '../utils/autodev-inspector-runtime';

export class RunPendingLogBatchTool implements Tool {
  definition: ToolDefinition = {
    name: 'run_pending_log_batch',
    description: '仅供 autodev-pending-review 子智能体内部使用：同步执行一次 AutoDev 待处理日志批处理，并返回结果摘要。',
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
    if (!String(context.sessionId || '').startsWith('subagent:')) {
      return '错误：run_pending_log_batch 仅允许在子智能体内部调用';
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
    const result = await worker.runOnce();

    if (result.skipped) {
      return this.formatPendingOnly(pending);
    }

    const processedLogs = pending.slice(0, result.processed);
    if (processedLogs.length === 0) {
      return 'Inspector 批处理已执行，但这次没有处理到待审日志。';
    }

    const details = await Promise.all(
      processedLogs.map(log => client.getLogDetail(log.log_id).catch(() => ({ log } as AutoDevLogDetail))),
    );

    return this.formatProcessed(processedLogs, details);
  }

  private normalizeLimit(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return 3;
    }
    return Math.max(1, Math.min(10, Math.floor(parsed)));
  }

  private formatPendingOnly(pending: AutoDevSessionLogSummary[]): string {
    return [
      'Inspector 批处理已在运行中，当前待审日志列表：',
      ...pending.map(log => this.formatLogRef(log)),
    ].join('\n');
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
}
