import * as path from 'path';
import { Tool, ToolDefinition, ToolExecutionContext } from '../../../types/tool';
import { prepareReviewEval } from '../utils/review-eval-profile';

const DEFAULT_MAX_CHARS = 3200;

export class ReviewerEvalPrepareTool implements Tool {
  definition: ToolDefinition = {
    name: 'reviewer_eval_prepare',
    description: [
      '为 ReviewerCat 生成项目级 Project Eval Profile、单次 Review Eval Plan、Boundary Map 和 Test Matrix。',
      '此工具不执行测试；它先回答“这个项目怎样才算真的能用”，再给后续 reviewer_module_test / E2E runner / Codex 返工使用。'
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description: '要评估的项目目录，默认当前工作目录。'
        },
        request: {
          type: 'string',
          description: '本次 review / case / PR 的自然语言目标。'
        },
        changed_files: {
          type: 'array',
          description: '本次改动涉及的文件路径列表。',
          items: { type: 'string' }
        },
        implementation_summary: {
          type: 'string',
          description: '工程实现摘要或候选交付说明。'
        },
        review_id: {
          type: 'string',
          description: '可选 review id；不填自动生成。'
        },
        output_dir: {
          type: 'string',
          description: '可选输出目录；不填默认 data/reviewer-runs/<review_id>。'
        },
        max_chars: {
          type: 'number',
          description: '最大返回字符数，默认 3200。完整内容会落盘。'
        }
      }
    }
  };

  async execute(args: any, context: ToolExecutionContext): Promise<string> {
    const cwd = resolveCwd(context.workingDirectory, args?.cwd);
    const outputDir = args?.output_dir ? resolveCwd(context.workingDirectory, args.output_dir) : undefined;
    const result = prepareReviewEval({
      cwd,
      outputDir,
      request: readOptionalString(args?.request),
      implementationSummary: readOptionalString(args?.implementation_summary),
      changedFiles: normalizeStringArray(args?.changed_files),
      reviewId: readOptionalString(args?.review_id),
    });
    return truncate(formatResult(result, context.workingDirectory), readPositiveNumber(args?.max_chars, DEFAULT_MAX_CHARS));
  }
}

function formatResult(result: ReturnType<typeof prepareReviewEval>, displayRoot: string): string {
  const required = result.plan.requiredChecks.map(check => `${check.id}:${check.level}`).join(', ') || 'none';
  const optional = result.plan.optionalChecks.map(check => `${check.id}:${check.level}`).join(', ') || 'none';
  const blocked = result.plan.blockedChecks.map(check => check.check).join('; ') || 'none';
  return [
    'reviewer_eval_prepare: status=prepared',
    `review_id=${result.reviewId}`,
    `project_type=${result.profile.projectType}`,
    `detected_types=${result.profile.detectedProjectTypes.join(',') || 'unknown'}`,
    `profile_source=${result.profile.source}`,
    `required_checks=${required}`,
    `optional_checks=${optional}`,
    `blocked_checks=${blocked}`,
    `run_dir=${relativeDisplayPath(result.runDir, displayRoot)}`,
    `evaluation_profile=${relativeDisplayPath(result.paths.evaluationProfileMarkdown, displayRoot)}`,
    `review_eval_plan=${relativeDisplayPath(result.paths.reviewEvalPlan, displayRoot)}`,
    `boundary_map=${relativeDisplayPath(result.paths.boundaryMap, displayRoot)}`,
    `test_matrix=${relativeDisplayPath(result.paths.testMatrix, displayRoot)}`,
    '',
    'next:',
    '- 读取 review_eval_plan 和 test_matrix。',
    '- 能自动跑的检查交给 reviewer_module_test / E2E runner。',
    '- 不能自动跑的检查写 blocked reason，不要伪装成通过。',
  ].join('\n');
}

function resolveCwd(base: string, value: unknown): string {
  const text = String(value || '.').trim();
  return path.resolve(base, text || '.');
}

function readOptionalString(value: unknown): string | undefined {
  const text = String(value || '').trim();
  return text || undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item).trim()).filter(Boolean);
}

function readPositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function relativeDisplayPath(filePath: string, root: string): string {
  const relative = path.relative(root, filePath).replace(/\\/g, '/');
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : filePath;
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? value.slice(0, maxChars - 3) + '...' : value;
}
