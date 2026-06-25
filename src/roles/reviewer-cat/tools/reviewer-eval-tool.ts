import * as path from 'path';
import { ArtifactManifestItem, Tool, ToolDefinition, ToolExecutionContext } from '../../../types/tool';
import { prepareReviewEval } from '../utils/review-eval-profile';

const DEFAULT_MAX_CHARS = 3200;

export class ReviewerEvalPrepareTool implements Tool {
  definition: ToolDefinition = {
    name: 'reviewer_eval_prepare',
    description: [
      '为 ReviewerCat 生成项目级 Project Eval Profile、单次 Review Eval Plan、Boundary Map 和真人端测场景矩阵。',
      '此工具不执行测试；它先回答“这个项目怎样才算真的能用”，再给后续 E2E runner / Codex 返工使用。低层测试只作为辅助证据。'
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
    if (args && typeof args === 'object') {
      args.__xiaoba_artifact_run_dir = result.runDir;
    }
    return truncate(formatResult(result, context.workingDirectory), readPositiveNumber(args?.max_chars, DEFAULT_MAX_CHARS));
  }

  getArtifactManifest(args: any, result: string, context: ToolExecutionContext): ArtifactManifestItem[] {
    const runDir = keyValue(result, 'run_dir') || inferRunDir(args, context.workingDirectory);
    return uniqueArtifacts([
      ...artifactsFromRunDir(runDir, [
        'task.json',
        'evaluation-profile.md',
        'evaluation-profile.json',
        'review-eval-plan.md',
        'boundary-map.md',
        'test-matrix.md',
        'summary.json',
      ], 'generated', context.workingDirectory),
      ...artifactsFromKeys(result, [
        'evaluation_profile',
        'review_eval_plan',
        'boundary_map',
        'test_matrix',
      ], 'generated', context.workingDirectory),
    ]);
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
    '- 读取 review_eval_plan 和 test_matrix（真人端测场景矩阵）。',
    '- 优先用 Dashboard/Pet/CLI/IM 等真实入口跑 E2E runner。',
    '- 低层测试结果只作为辅助证据；不能自动跑的真人路径写 blocked reason，不要伪装成通过。',
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

function inferRunDir(args: any, workingDirectory: string): string {
  const artifactRunDir = readOptionalString(args?.__xiaoba_artifact_run_dir);
  if (artifactRunDir) {
    return artifactRunDir;
  }
  if (args?.output_dir) {
    return resolveCwd(workingDirectory, args.output_dir);
  }
  const reviewId = readOptionalString(args?.review_id);
  const cwd = resolveCwd(workingDirectory, args?.cwd);
  return reviewId ? path.join(cwd, 'data', 'reviewer-runs', safeSegment(reviewId)) : '';
}

function artifactsFromRunDir(
  runDir: string,
  fileNames: string[],
  action: ArtifactManifestItem['action'],
  workingDirectory: string,
): ArtifactManifestItem[] {
  if (!runDir) return [];
  return fileNames
    .map(fileName => artifactFromPath(path.join(runDir, fileName), action, workingDirectory))
    .filter((item): item is ArtifactManifestItem => Boolean(item));
}

function artifactsFromKeys(
  result: string,
  keys: string[],
  action: ArtifactManifestItem['action'],
  workingDirectory: string,
): ArtifactManifestItem[] {
  return keys
    .map(key => artifactFromPath(keyValue(result, key), action, workingDirectory))
    .filter((item): item is ArtifactManifestItem => Boolean(item));
}

function artifactFromPath(
  value: unknown,
  action: ArtifactManifestItem['action'],
  workingDirectory: string,
): ArtifactManifestItem | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = workspaceRelativeArtifactPath(value, workingDirectory);
  return {
    path: normalized,
    type: artifactType(normalized),
    action,
  };
}

function keyValue(text: string, key: string): string {
  const pattern = new RegExp(`^${key}=([^\\r\\n]+)$`, 'm');
  return pattern.exec(String(text || ''))?.[1]?.trim() || '';
}

function workspaceRelativeArtifactPath(value: string, workingDirectory: string): string {
  const normalized = value.trim().replace(/\\/g, '/');
  const cwd = workingDirectory.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalized.startsWith(`${cwd}/`)) {
    return normalized.slice(cwd.length + 1);
  }
  return normalized.replace(/^\/+/, '');
}

function artifactType(filePath: string): string {
  const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
  return ext || 'file';
}

function uniqueArtifacts(items: ArtifactManifestItem[]): ArtifactManifestItem[] {
  const seen = new Set<string>();
  const unique: ArtifactManifestItem[] = [];
  for (const item of items) {
    const key = `${item.path}\0${item.action}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function safeSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'review';
}

function relativeDisplayPath(filePath: string, root: string): string {
  const relative = path.relative(root, filePath).replace(/\\/g, '/');
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : filePath;
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? value.slice(0, maxChars - 3) + '...' : value;
}
