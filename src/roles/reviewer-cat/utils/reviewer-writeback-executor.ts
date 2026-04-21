import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { AutoDevCaseDetail } from '../../../utils/autodev-client';
import {
  AutoDevWritebackAction,
  AutoDevWritebackActionResult,
  AutoDevWritebackPlan,
  AutoDevWritebackResult,
  normalizeStringArray,
} from '../../../utils/autodev-loop-contract';

export interface ReviewerDownloadedArtifactManifestItem {
  artifactId: string;
  type: string;
  stage: string;
  title: string;
  localPath: string;
  originalFilename?: string | null;
}

export interface ReviewerWritebackExecutionInput {
  detail: AutoDevCaseDetail;
  workspaceDir: string;
  downloadedArtifacts: ReviewerDownloadedArtifactManifestItem[];
  writebackPlan: AutoDevWritebackPlan;
}

export interface ReviewerWritebackExecutor {
  execute(input: ReviewerWritebackExecutionInput): Promise<AutoDevWritebackResult>;
}

interface ReviewerWritebackExecutorOptions {
  repoRoot?: string;
  enabled?: boolean;
}

export class LocalReviewerWritebackExecutor implements ReviewerWritebackExecutor {
  private readonly repoRoot: string;
  private readonly enabled: boolean;

  constructor(options: ReviewerWritebackExecutorOptions = {}) {
    this.repoRoot = path.resolve(options.repoRoot || process.cwd());
    this.enabled = options.enabled !== false;
  }

  async execute(input: ReviewerWritebackExecutionInput): Promise<AutoDevWritebackResult> {
    if (!this.enabled) {
      return {
        version: 1,
        caseId: input.detail.case.case_id,
        generatedAt: new Date().toISOString(),
        enabled: false,
        status: 'skipped',
        summary: 'Reviewer writeback is disabled by configuration.',
        reason: 'AUTODEV_REVIEWER_WRITEBACK_ENABLED=false',
        actionResults: [],
      };
    }

    if (!input.writebackPlan.enabled) {
      return {
        version: 1,
        caseId: input.detail.case.case_id,
        generatedAt: new Date().toISOString(),
        enabled: false,
        status: 'skipped',
        summary: 'Writeback plan is disabled for this case.',
        reason: input.writebackPlan.reason,
        actionResults: [],
      };
    }

    const actionResults = (input.writebackPlan.actions || [])
      .map(action => this.executeAction(input, action));
    const failedCount = actionResults.filter(item => item.status === 'failed').length;
    const appliedCount = actionResults.filter(item => item.status === 'completed').length;
    const skippedCount = actionResults.filter(item => item.status === 'skipped').length;

    let status: 'completed' | 'skipped' | 'failed' = 'skipped';
    if (failedCount > 0) {
      status = 'failed';
    } else if (appliedCount > 0) {
      status = 'completed';
    } else if (skippedCount > 0) {
      status = 'skipped';
    }

    return {
      version: 1,
      caseId: input.detail.case.case_id,
      generatedAt: new Date().toISOString(),
      enabled: true,
      status,
      summary: buildWritebackSummary(status, appliedCount, failedCount, skippedCount),
      reason: input.writebackPlan.reason,
      actionResults,
    };
  }

  private executeAction(
    input: ReviewerWritebackExecutionInput,
    action: AutoDevWritebackAction,
  ): AutoDevWritebackActionResult {
    try {
      const targetPaths = normalizeStringArray(action.paths);
      const sourceArtifacts = this.resolveSourceArtifactPaths(input, action);

      if (action.applyMode === 'manual' || action.action === 'manual_follow_up') {
        return {
          target: action.target,
          action: action.action,
          status: 'skipped',
          summary: action.summary,
          detail: 'Action is marked as manual and was not auto-applied.',
          appliedPaths: targetPaths,
          sourceArtifacts: sourceArtifacts.map(item => path.basename(item)),
        };
      }

      const patchPath = this.findPatchPath(input, action, sourceArtifacts);
      if (patchPath && this.shouldUsePatch(action)) {
        return this.applyPatchAction(action, patchPath, targetPaths);
      }

      if (action.action === 'apply_patch') {
        return {
          target: action.target,
          action: action.action,
          status: 'failed',
          summary: action.summary,
          detail: 'No patch artifact was available for auto writeback.',
          appliedPaths: targetPaths,
          sourceArtifacts: sourceArtifacts.map(item => path.basename(item)),
        };
      }

      return this.copyActionFiles(input, action, targetPaths, sourceArtifacts);
    } catch (error: any) {
      return {
        target: action.target,
        action: action.action,
        status: 'failed',
        summary: action.summary,
        detail: String(error?.message || error || 'Unknown writeback error'),
      };
    }
  }

  private applyPatchAction(
    action: AutoDevWritebackAction,
    patchPath: string,
    targetPaths: string[],
  ): AutoDevWritebackActionResult {
    try {
      execFileSync('git', ['apply', '--reject', '--whitespace=nowarn', patchPath], {
        cwd: this.repoRoot,
        stdio: 'pipe',
      });
      return {
        target: action.target,
        action: action.action,
        status: 'completed',
        summary: action.summary,
        detail: `Applied patch ${path.basename(patchPath)} to ${this.repoRoot}.`,
        appliedPaths: targetPaths.length > 0 ? targetPaths : extractPatchedPaths(patchPath),
        sourceArtifacts: [path.basename(patchPath)],
      };
    } catch (error: any) {
      const stderr = Buffer.isBuffer(error?.stderr)
        ? error.stderr.toString('utf-8').trim()
        : String(error?.stderr || '').trim();
      const message = stderr || String(error?.message || error || 'Unknown writeback error');
      return {
        target: action.target,
        action: action.action,
        status: 'failed',
        summary: action.summary,
        detail: `Patch apply failed: ${message}`,
        appliedPaths: targetPaths,
        sourceArtifacts: [path.basename(patchPath)],
      };
    }
  }

  private copyActionFiles(
    input: ReviewerWritebackExecutionInput,
    action: AutoDevWritebackAction,
    targetPaths: string[],
    sourceArtifacts: string[],
  ): AutoDevWritebackActionResult {
    if (targetPaths.length === 0) {
      return {
        target: action.target,
        action: action.action,
        status: 'skipped',
        summary: action.summary,
        detail: 'Action has no target paths and no patch artifact; nothing was applied.',
        sourceArtifacts: sourceArtifacts.map(item => path.basename(item)),
      };
    }

    const missing: string[] = [];
    const applied: string[] = [];

    for (const targetPath of targetPaths) {
      const sourcePath = this.findSourcePathForTarget(input, targetPath, sourceArtifacts);
      if (!sourcePath) {
        missing.push(targetPath);
        continue;
      }

      const destinationPath = path.resolve(this.repoRoot, targetPath);
      this.assertPathInsideRepoRoot(destinationPath);
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });

      const stat = fs.statSync(sourcePath);
      if (stat.isDirectory()) {
        fs.cpSync(sourcePath, destinationPath, { recursive: true });
      } else {
        fs.copyFileSync(sourcePath, destinationPath);
      }

      applied.push(normalizePath(targetPath));
    }

    if (missing.length > 0) {
      return {
        target: action.target,
        action: action.action,
        status: 'failed',
        summary: action.summary,
        detail: `Writeback could not resolve source files for: ${missing.join(', ')}`,
        appliedPaths: applied,
        sourceArtifacts: sourceArtifacts.map(item => path.basename(item)),
      };
    }

    return {
      target: action.target,
      action: action.action,
      status: 'completed',
      summary: action.summary,
      detail: `Copied ${applied.length} file(s) back into the repository.`,
      appliedPaths: applied,
      sourceArtifacts: sourceArtifacts.map(item => path.basename(item)),
    };
  }

  private shouldUsePatch(action: AutoDevWritebackAction): boolean {
    return action.action !== 'manual_follow_up';
  }

  private findPatchPath(
    input: ReviewerWritebackExecutionInput,
    action: AutoDevWritebackAction,
    sourceArtifacts: string[],
  ): string | undefined {
    const artifactNames = new Set(
      normalizeStringArray(action.sourceArtifacts)
        .map(item => normalizePath(item).toLowerCase())
        .concat(['implementation.patch']),
    );

    for (const candidate of sourceArtifacts) {
      const normalized = normalizePath(candidate).toLowerCase();
      if (normalized.endsWith('.patch') || artifactNames.has(path.basename(normalized))) {
        return candidate;
      }
    }

    const downloadedPatch = input.downloadedArtifacts.find(item => item.type === 'patch');
    return downloadedPatch
      ? path.resolve(input.workspaceDir, downloadedPatch.localPath)
      : undefined;
  }

  private resolveSourceArtifactPaths(
    input: ReviewerWritebackExecutionInput,
    action: AutoDevWritebackAction,
  ): string[] {
    const resolved = new Set<string>();
    const sourceNames = new Set(
      normalizeStringArray(action.sourceArtifacts)
        .map(item => normalizePath(item).toLowerCase()),
    );

    for (const artifact of input.downloadedArtifacts) {
      const localPath = path.resolve(input.workspaceDir, artifact.localPath);
      const localName = path.basename(localPath).toLowerCase();
      const originalName = normalizePath(String(artifact.originalFilename || '')).toLowerCase();
      const titleName = normalizePath(String(artifact.title || '')).toLowerCase();
      if (
        sourceNames.size === 0
        || sourceNames.has(localName)
        || (originalName && sourceNames.has(originalName))
        || (titleName && sourceNames.has(titleName))
      ) {
        resolved.add(localPath);
      }
    }

    for (const sourceName of sourceNames) {
      const workspacePath = path.resolve(input.workspaceDir, sourceName);
      if (fs.existsSync(workspacePath)) {
        resolved.add(workspacePath);
      }
    }

    return Array.from(resolved);
  }

  private findSourcePathForTarget(
    input: ReviewerWritebackExecutionInput,
    targetPath: string,
    sourceArtifacts: string[],
  ): string | undefined {
    const workspaceCandidate = path.resolve(input.workspaceDir, targetPath);
    if (fs.existsSync(workspaceCandidate)) {
      return workspaceCandidate;
    }

    const normalizedTarget = normalizePath(targetPath).toLowerCase();
    const targetBaseName = path.basename(normalizedTarget);
    const artifactMatch = input.downloadedArtifacts.find(item => {
      const originalName = normalizePath(String(item.originalFilename || '')).toLowerCase();
      const localName = path.basename(normalizePath(item.localPath)).toLowerCase();
      return originalName === normalizedTarget
        || originalName === targetBaseName
        || localName === targetBaseName;
    });
    if (artifactMatch) {
      const artifactPath = path.resolve(input.workspaceDir, artifactMatch.localPath);
      if (fs.existsSync(artifactPath)) {
        return artifactPath;
      }
    }

    return sourceArtifacts.find(item => {
      const normalized = normalizePath(item).toLowerCase();
      return normalized.endsWith(`/${normalizedTarget}`) || path.basename(normalized) === targetBaseName;
    });
  }

  private assertPathInsideRepoRoot(targetPath: string): void {
    const relative = path.relative(this.repoRoot, targetPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Writeback target escapes repo root: ${targetPath}`);
    }
  }
}

export function createReviewerWritebackExecutorFromEnv(): ReviewerWritebackExecutor {
  return new LocalReviewerWritebackExecutor({
    enabled: readBooleanEnv('AUTODEV_REVIEWER_WRITEBACK_ENABLED', true),
  });
}

function buildWritebackSummary(
  status: 'completed' | 'skipped' | 'failed',
  appliedCount: number,
  failedCount: number,
  skippedCount: number,
): string {
  if (status === 'completed') {
    return `Applied ${appliedCount} writeback action(s); ${skippedCount} skipped.`;
  }
  if (status === 'failed') {
    return `Writeback finished with ${failedCount} failed action(s) and ${appliedCount} applied action(s).`;
  }
  return `No writeback actions were applied; ${skippedCount} action(s) skipped.`;
}

function extractPatchedPaths(patchPath: string): string[] {
  try {
    const content = fs.readFileSync(patchPath, 'utf-8');
    const matches = content.matchAll(/^\+\+\+ b\/(.+)$/gm);
    return Array.from(new Set(Array.from(matches).map(match => normalizePath(match[1]))));
  } catch {
    return [];
  }
}

function normalizePath(value: string): string {
  return String(value || '').replace(/\\/g, '/').trim();
}

function readBooleanEnv(key: string, fallback: boolean): boolean {
  const raw = String(process.env[key] || '').trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  return !['0', 'false', 'off', 'no'].includes(raw);
}
