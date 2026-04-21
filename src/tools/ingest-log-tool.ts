import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { Tool, ToolDefinition, ToolExecutionContext } from '../types/tool';
import { AutoDevClient } from '../utils/autodev-client';

export class IngestLogTool implements Tool {
  definition: ToolDefinition = {
    name: 'ingest_log',
    description: '将 XiaoBa 的 session 日志上传到 AutoDev log 存档。日志在 logs/sessions/ 下的 .jsonl 文件。不传 date 时自动选最新日期。只在用户明确要求上传日志时使用。',
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: '日志日期，格式 YYYY-MM-DD。不填时自动选最新日期。',
        },
        session_type: {
          type: 'string',
          description: '渠道类型，如 feishu、weixin、cli。不填时上传所有渠道。',
        },
      },
      required: [],
    },
  };

  async execute(args: any, context: ToolExecutionContext): Promise<string> {
    const client = new AutoDevClient();
    if (!client.isConfigured()) {
      return '错误：AUTODEV_SERVER_URL 未配置';
    }

    const logsRoot = path.resolve(context.workingDirectory, 'logs', 'sessions');
    if (!fs.existsSync(logsRoot)) {
      return '错误：logs/sessions 目录不存在';
    }

    const pattern = args.session_type
      ? `${args.session_type}/**/*.jsonl`
      : '**/*.jsonl';

    const candidates = await glob(pattern, {
      cwd: logsRoot,
      absolute: false,
      nodir: true,
      windowsPathsNoEscape: true,
    });

    // 按日期过滤
    const filtered = args.date
      ? candidates.filter(f => f.replace(/\\/g, '/').includes(`/${args.date}/`))
      : candidates;

    if (filtered.length === 0) {
      return '未找到可上传的日志文件';
    }

    let uploaded = 0;
    const errors: string[] = [];

    for (const relativePath of filtered) {
      const parts = relativePath.replace(/\\/g, '/').split('/');
      const sessionType = parts[0] || 'unknown';
      const logDate = parts[1] || '';
      const filename = parts[2] || '';
      const absolutePath = path.join(logsRoot, relativePath);
      const sessionId = this.readSessionIdFromJsonl(absolutePath) || this.parseSessionIdFromFilename(filename) || filename.replace(/\.jsonl$/, '');

      try {
        await client.ingestLog({ filePath: absolutePath, sessionType, sessionId, logDate });
        uploaded++;
      } catch (err: any) {
        errors.push(`${filename}: ${err.message}`);
      }
    }

    const parts = [`已上传 ${uploaded} 个日志文件到 AutoDev log 存档`];
    if (errors.length > 0) {
      parts.push(`失败 ${errors.length} 个: ${errors.join(', ')}`);
    }
    return parts.join('。');
  }

  private readSessionIdFromJsonl(filePath: string): string | undefined {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const firstLine = content
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(Boolean);
      if (!firstLine) {
        return undefined;
      }
      const parsed = JSON.parse(firstLine);
      return typeof parsed?.session_id === 'string' ? parsed.session_id : undefined;
    } catch {
      return undefined;
    }
  }

  private parseSessionIdFromFilename(filename: string): string | undefined {
    const basename = filename.replace(/\.jsonl$/i, '');
    if (basename.startsWith('user_')) {
      return `user:${basename.slice('user_'.length)}`;
    }
    if (basename.startsWith('group_')) {
      return `group:${basename.slice('group_'.length)}`;
    }

    const userMatch = basename.match(/(?:^|_)user_(.+)$/);
    if (userMatch) {
      return `user:${userMatch[1]}`;
    }

    const groupMatch = basename.match(/(?:^|_)group_(.+)$/);
    if (groupMatch) {
      return `group:${groupMatch[1]}`;
    }

    return undefined;
  }
}
