import { Tool, ToolDefinition, ToolExecutionContext } from '../../../types/tool';
import { isAutoDevConfigured } from '../../../utils/autodev-config';
import { AutoDevInspectorWorker } from '../utils/autodev-inspector-worker';
import { getActiveAutoDevInspectorWorker } from '../utils/autodev-inspector-runtime';

export class RunInspectorBatchTool implements Tool {
  definition: ToolDefinition = {
    name: 'run_inspector_batch',
    description: '立即触发一次 inspector 的 AutoDev 日志批处理。只在用户明确要求立即运行 inspector 审查时使用。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  };

  async execute(_args: any, context: ToolExecutionContext): Promise<string> {
    if (!isAutoDevConfigured()) {
      return '错误：AUTODEV_SERVER_URL 未配置';
    }

    const worker = getActiveAutoDevInspectorWorker() || new AutoDevInspectorWorker({
      workingDirectory: context.workingDirectory,
    });
    const result = await worker.runOnce();

    if (result.skipped) {
      return 'Inspector 批处理已在运行中，未重复启动。';
    }

    return `Inspector 批处理已执行，处理 ${result.processed} 条待审日志。`;
  }
}
