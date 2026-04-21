import * as fs from 'fs';
import * as path from 'path';
import * as Lark from '@larksuiteoapi/node-sdk';
import { MessageSender } from '../../../feishu/message-sender';
import { Logger } from '../../../utils/logger';
import { InspectorCaseRecord } from './inspector-case-store';

export interface InspectorCaseAnalysisResult {
  generatedAt: string;
  caseId: string;
  analysisType: string;
  source?: string;
  userRequest?: string;
  summary: {
    overview: string;
    fileCount: number;
    totalTurns: number;
    totalTokens: number;
    totalToolCalls: number;
    topIssueCounts: Record<string, number>;
  };
  files?: Array<unknown>;
  findings: {
    topFiles?: Array<unknown>;
    runtimeFindings: Array<{
      issueType: string;
      count: number;
      recommendation: string;
      evidence: string[];
    }>;
    skillSignals?: Array<unknown>;
    skillOpportunities?: Array<unknown>;
    activitySummary?: unknown;
    actionItems?: string[];
  };
  reportMarkdown?: string;
}

export interface InspectorCaseFailureResult {
  generatedAt: string;
  caseId: string;
  error: string;
}

export interface InspectorReportNotifier {
  notifyAnalyzed(
    record: InspectorCaseRecord,
    result: InspectorCaseAnalysisResult,
    reportFilePath?: string,
  ): Promise<void>;
  notifyFailed(record: InspectorCaseRecord, failure: InspectorCaseFailureResult): Promise<void>;
}

class FeishuInspectorReportNotifier implements InspectorReportNotifier {
  constructor(
    private readonly sender: MessageSender,
    private readonly reportChatId: string,
  ) {}

  async notifyAnalyzed(
    record: InspectorCaseRecord,
    result: InspectorCaseAnalysisResult,
    reportFilePath?: string,
  ): Promise<void> {
    const topIssues = Object.entries(result.summary.topIssueCounts || {})
      .slice(0, 3)
      .map(([name, count]) => `${name} x${count}`)
      .join('；') || '无明显 issue';
    const runtimeFindings = result.findings.runtimeFindings
      .slice(0, 2)
      .map(finding => `${finding.issueType}(${finding.count})`)
      .join('，') || '未发现明显 runtime 大问题';

    const text = [
      `督察猫已完成一份日志审查。`,
      `caseId: ${record.caseId}`,
      `类型: ${record.analysisType}`,
      `概览: ${result.summary.overview}`,
      `规模: ${result.summary.fileCount} 个文件，${result.summary.totalTurns} turns，${result.summary.totalTokens} tokens`,
      `Top issues: ${topIssues}`,
      `Runtime findings: ${runtimeFindings}`,
      `建议: ${((result.findings as any).actionItems || []).slice(0, 2).join('；') || '查看报告文件'}`,
    ].join('\n');

    await this.sender.reply(this.reportChatId, text);
    Logger.info(`[InspectorNotifier] report summary sent to ${this.reportChatId}`);

    if (reportFilePath && fs.existsSync(reportFilePath)) {
      await this.sender.sendFile(this.reportChatId, reportFilePath, path.basename(reportFilePath));
      Logger.info(`[InspectorNotifier] report file sent to ${this.reportChatId}`);
    }
  }

  async notifyFailed(record: InspectorCaseRecord, failure: InspectorCaseFailureResult): Promise<void> {
    const text = [
      `督察猫日志分析失败。`,
      `caseId: ${record.caseId}`,
      `类型: ${record.analysisType}`,
      `错误: ${failure.error}`,
    ].join('\n');

    await this.sender.reply(this.reportChatId, text);
    Logger.info(`[InspectorNotifier] failure summary sent to ${this.reportChatId}`);
  }
}

export function createInspectorReportNotifierFromEnv(): InspectorReportNotifier | null {
  if (process.env.INSPECTOR_REPORT_ENABLED === 'false') {
    return null;
  }

  const reportChatId = String(process.env.INSPECTOR_REPORT_FEISHU_CHAT_ID || '').trim();
  if (!reportChatId) {
    return null;
  }

  const appId = String(process.env.FEISHU_APP_ID || '').trim();
  const appSecret = String(process.env.FEISHU_APP_SECRET || '').trim();
  if (!appId || !appSecret) {
    Logger.warning('[InspectorNotifier] FEISHU_APP_ID/FEISHU_APP_SECRET 未配置，无法发送报告群通知');
    return null;
  }

  const client = new Lark.Client({ appId, appSecret });
  const sender = new MessageSender(client);
  return new FeishuInspectorReportNotifier(sender, reportChatId);
}
