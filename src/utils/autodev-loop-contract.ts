import * as fs from 'fs';
import { AutoDevCaseDetail } from './autodev-client';

export type AutoDevIssueCategory =
  | 'runtime_bug'
  | 'new_skill_candidate'
  | 'skill_fix'
  | 'insufficient_signal';

export type AutoDevInspectorNextState = 'fixing' | 'blocked';
export type AutoDevEngineerNextState = 'reviewing' | 'blocked';
export type AutoDevReviewerDecision = 'closed' | 'reopened';
export type AutoDevReviewerNextState = 'closed' | 'reopened';
export type AutoDevWritebackStatus = 'completed' | 'skipped' | 'failed';

export interface AutoDevEvidenceSummary {
  rootCauseHypothesis?: string;
  confidence?: string;
  signals?: string[];
}

export interface AutoDevInspectorHandoff {
  version: 1;
  shouldCreateCase?: boolean;
  title: string;
  category: AutoDevIssueCategory;
  priority?: string;
  recommendedNextAction?: string;
  summary: string;
  nextState: AutoDevInspectorNextState;
  evidenceSummary?: AutoDevEvidenceSummary;
  labels?: string[];
}

export interface AutoDevEngineerArtifactDescriptor {
  path: string;
  type?: string;
  stage?: string;
  title?: string;
  format?: string;
  contentType?: string;
}

export interface AutoDevEngineerOutput {
  version: 1;
  summary: string;
  overview?: string;
  resultType?: string;
  riskLevel?: string;
  nextState?: AutoDevEngineerNextState;
  recommendedNextAction?: string;
  changedFiles?: string[];
  artifacts?: AutoDevEngineerArtifactDescriptor[];
}

export interface AutoDevReviewerArtifactDescriptor {
  path: string;
  type?: string;
  stage?: string;
  title?: string;
  format?: string;
  contentType?: string;
}

export type AutoDevWritebackTarget = 'runtime' | 'skill' | 'prompt' | 'docs' | 'memory';
export type AutoDevWritebackActionType =
  | 'apply_patch'
  | 'publish_skill'
  | 'update_skill'
  | 'update_prompt'
  | 'document_learning'
  | 'manual_follow_up';

export interface AutoDevWritebackAction {
  target: AutoDevWritebackTarget;
  action: AutoDevWritebackActionType;
  summary: string;
  applyMode?: 'auto' | 'manual';
  paths?: string[];
  sourceArtifacts?: string[];
}

export interface AutoDevWritebackPlan {
  enabled: boolean;
  reason?: string;
  actions: AutoDevWritebackAction[];
}

export interface AutoDevLoopMetrics {
  computedAt: string;
  caseId: string;
  category?: string;
  decision?: AutoDevReviewerDecision;
  cycleSeconds?: number;
  eventCount: number;
  artifactCount: number;
  reopenedCount: number;
  changedFileCount: number;
  fixToReviewSeconds?: number;
  reviewToDecisionSeconds?: number;
  writebackStatus?: AutoDevWritebackStatus;
  writebackActionCount?: number;
  writebackAppliedCount?: number;
  writebackFailedCount?: number;
}

export interface AutoDevReviewerOutput {
  version: 1;
  summary: string;
  overview?: string;
  decision: AutoDevReviewerDecision;
  decisionReason: string;
  nextState?: AutoDevReviewerNextState;
  regressionStatus?: string;
  riskLevel?: string;
  artifacts?: AutoDevReviewerArtifactDescriptor[];
  writebackPlan?: AutoDevWritebackPlan;
  metrics?: Partial<AutoDevLoopMetrics>;
}

export interface AutoDevWritebackActionResult {
  target: AutoDevWritebackTarget;
  action: AutoDevWritebackActionType;
  status: AutoDevWritebackStatus;
  summary: string;
  detail: string;
  appliedPaths?: string[];
  sourceArtifacts?: string[];
}

export interface AutoDevWritebackResult {
  version: 1;
  caseId: string;
  generatedAt: string;
  enabled: boolean;
  status: AutoDevWritebackStatus;
  summary: string;
  reason?: string;
  actionResults: AutoDevWritebackActionResult[];
}

export function readJsonFile<T>(filePath: string): T | undefined {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    if (!raw) {
      return undefined;
    }
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(item => String(item || '').trim())
    .filter(Boolean);
}

export function createDefaultWritebackPlan(input: {
  detail: AutoDevCaseDetail;
  engineerOutput?: AutoDevEngineerOutput;
  reviewerOutput: AutoDevReviewerOutput;
}): AutoDevWritebackPlan {
  const { detail, engineerOutput, reviewerOutput } = input;
  const category = String(detail.case.category || '').trim();
  const changedFiles = normalizeStringArray(engineerOutput?.changedFiles);
  const hasPatchArtifact = (detail.artifacts || []).some(artifact =>
    String(artifact.type || '').trim() === 'patch'
    || String(artifact.original_filename || '').trim() === 'implementation.patch',
  );
  const sourceArtifacts = Array.from(new Set([
    'implementation.md',
    'engineer-output.json',
    'review.md',
    'reviewer-output.json',
    'implementation.patch',
  ]));

  if (reviewerOutput.decision !== 'closed') {
    return {
      enabled: false,
      reason: 'Case is not closed; writeback must wait for a validated closure.',
      actions: [],
    };
  }

  switch (category) {
    case 'runtime_bug':
      return {
        enabled: true,
        reason: 'Validated runtime fix can be written back to the main runtime code path.',
        actions: [{
          target: 'runtime',
          action: 'apply_patch',
          summary: 'Apply the validated runtime fix back to the runtime repository.',
          applyMode: hasPatchArtifact ? 'auto' : 'manual',
          paths: changedFiles,
          sourceArtifacts,
        }],
      };
    case 'skill_fix':
      return {
        enabled: true,
        reason: 'Validated skill fix can be written back to the existing skill bundle.',
        actions: [{
          target: 'skill',
          action: 'update_skill',
          summary: 'Write the validated skill fix back to the existing skill.',
          applyMode: hasPatchArtifact ? 'auto' : 'manual',
          paths: changedFiles,
          sourceArtifacts,
        }],
      };
    case 'new_skill_candidate':
      return {
        enabled: true,
        reason: 'Validated new skill can be published back to the skill registry.',
        actions: [{
          target: 'skill',
          action: 'publish_skill',
          summary: 'Publish the validated new skill bundle.',
          applyMode: hasPatchArtifact ? 'auto' : 'manual',
          paths: changedFiles,
          sourceArtifacts,
        }],
      };
    default:
      return {
        enabled: false,
        reason: 'Current category does not support automatic writeback planning.',
        actions: [],
      };
  }
}

export function createLoopMetrics(input: {
  detail: AutoDevCaseDetail;
  engineerOutput?: AutoDevEngineerOutput;
  reviewerOutput: AutoDevReviewerOutput;
  computedAt?: string;
}): AutoDevLoopMetrics {
  const { detail, engineerOutput, reviewerOutput } = input;
  const computedAt = input.computedAt || new Date().toISOString();
  const createdAt = parseDate(detail.case.created_at);
  const fixingAt = findStateChangedAt(detail, 'fixing');
  const reviewingAt = findStateChangedAt(detail, 'reviewing');
  const reopenedCount = (detail.events || [])
    .filter(event => event.kind === 'state_changed' && String(event.payload?.target_status || '') === 'reopened')
    .length + (reviewerOutput.decision === 'reopened' ? 1 : 0);

  return {
    computedAt,
    caseId: detail.case.case_id,
    category: detail.case.category || undefined,
    decision: reviewerOutput.decision,
    cycleSeconds: diffSeconds(createdAt, parseDate(computedAt)),
    eventCount: Array.isArray(detail.events) ? detail.events.length : 0,
    artifactCount: Array.isArray(detail.artifacts) ? detail.artifacts.length : 0,
    reopenedCount,
    changedFileCount: normalizeStringArray(engineerOutput?.changedFiles).length,
    fixToReviewSeconds: diffSeconds(fixingAt, reviewingAt),
    reviewToDecisionSeconds: diffSeconds(reviewingAt, parseDate(computedAt)),
  };
}

function findStateChangedAt(detail: AutoDevCaseDetail, targetState: string): Date | undefined {
  const match = (detail.events || [])
    .find(event => event.kind === 'state_changed' && String(event.payload?.target_status || '') === targetState);
  return parseDate(match?.created_at);
}

function parseDate(value: unknown): Date | undefined {
  const text = String(value || '').trim();
  if (!text) {
    return undefined;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function diffSeconds(start?: Date, end?: Date): number | undefined {
  if (!start || !end) {
    return undefined;
  }
  return Math.max(Math.round((end.getTime() - start.getTime()) / 1000), 0);
}
