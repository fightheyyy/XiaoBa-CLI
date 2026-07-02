import * as fs from 'fs';
import * as path from 'path';
import { ArenaDecision } from './types';
import { PathResolver } from '../utils/path-resolver';

export type ArenaEffectivenessDecision = 'pass' | 'needs_tuning' | 'invalid';
export type ArenaVerifierStatus = 'pass' | 'fail' | 'blocked' | 'unsafe';
export type ArenaEffectivenessIssueCategory = 'blocking' | 'warning' | 'risk';

export interface ArenaEffectivenessVerifierResult {
  status: ArenaVerifierStatus;
  ref?: string;
  message?: string;
}

export interface ArenaEffectivenessIssue {
  issue_type: string;
  category: ArenaEffectivenessIssueCategory;
  severity?: 'high' | 'medium' | 'low';
  evidence_refs?: string[];
  description?: string;
}

export interface ArenaEffectivenessObservedRun {
  run_id: string;
  case_id: string;
  arena_scorecard_ref?: string;
  arena_decision: ArenaDecision;
  verifier_results: ArenaEffectivenessVerifierResult[];
  issues?: ArenaEffectivenessIssue[];
  unsafe_observed?: boolean;
  replay_trace_refs?: string[];
  replay_results?: Array<{ status: 'pass' | 'fail' | 'blocked' }>;
}

export interface ArenaEffectivenessScorecard {
  version: 1;
  scorecard_type: 'arena_effectiveness';
  run_id: string;
  case_id: string;
  source_case_ref: string;
  arena_scorecard_ref?: string;
  external_truth: {
    expected_decision: ArenaDecision;
    verifier_status_counts: Record<ArenaVerifierStatus, number>;
    verifier_refs: string[];
  };
  arena: {
    observed_decision: ArenaDecision;
    issue_count: number;
    blocking_issue_count: number;
    warning_count: number;
    risk_count: number;
    issues_without_evidence: string[];
  };
  alignment: {
    score: number;
    decision_agreement: boolean;
    false_pass: boolean;
    false_blocking: boolean;
    verifier_evidence_present: boolean;
    issue_evidence_completeness: number;
    warning_precision: number;
  };
  overall: {
    score: number;
    decision: ArenaEffectivenessDecision;
    blocking_failure?: string;
    recommendations: string[];
  };
}

export function scoreArenaEffectivenessObservedRun(
  observed: ArenaEffectivenessObservedRun,
  options: { projectRoot?: string } = {},
): ArenaEffectivenessScorecard {
  const projectRoot = path.resolve(options.projectRoot || PathResolver.getProjectRoot());
  const sourceCaseRoot = path.join(projectRoot, 'arena', 'benchmarks', 'cat-effectiveness', 'cases', observed.case_id);
  const expectedDecision = expectedArenaDecision(observed);
  const issues = observed.issues || [];
  const warningIssues = issues.filter(issue => issue.category === 'warning');
  const riskIssues = issues.filter(issue => issue.category === 'risk');
  const blockingIssues = issues.filter(issue => issue.category === 'blocking');
  const issuesWithoutEvidence = issues
    .filter(issue => (issue.evidence_refs || []).length === 0)
    .map(issue => issue.issue_type);
  const verifierRefs = observed.verifier_results
    .map(result => result.ref)
    .filter((value): value is string => Boolean(value));
  const verifierEvidencePresent = verifierRefs.length > 0;
  const decisionAgreement = observed.arena_decision === expectedDecision;
  const falsePass = expectedDecision !== 'pass' && observed.arena_decision === 'pass';
  const falseBlocking = expectedDecision === 'pass'
    && (observed.arena_decision === 'reopened' || observed.arena_decision === 'blocked');
  const issueEvidenceCompleteness = ratio(
    issues.length - issuesWithoutEvidence.length,
    issues.length,
    1,
  );
  const warningPrecision = ratio(
    [...warningIssues, ...riskIssues].filter(issue => (issue.evidence_refs || []).length > 0).length,
    warningIssues.length + riskIssues.length,
    1,
  );
  const alignmentScore = scoreAlignment({
    decisionAgreement,
    falsePass,
    falseBlocking,
    verifierEvidencePresent,
    issueEvidenceCompleteness,
    warningPrecision,
  });
  const recommendations = buildRecommendations({
    expectedDecision,
    observedDecision: observed.arena_decision,
    falsePass,
    falseBlocking,
    verifierEvidencePresent,
    issueEvidenceCompleteness,
    warningPrecision,
    issuesWithoutEvidence,
  });
  const blockingFailure = falsePass
    ? 'arena_false_pass'
    : falseBlocking ? 'arena_false_blocking' : undefined;
  const overallDecision: ArenaEffectivenessDecision = blockingFailure
    ? 'invalid'
    : alignmentScore >= 90 ? 'pass' : 'needs_tuning';

  return {
    version: 1,
    scorecard_type: 'arena_effectiveness',
    run_id: observed.run_id,
    case_id: observed.case_id,
    source_case_ref: relativeRef(projectRoot, sourceCaseRoot),
    ...(observed.arena_scorecard_ref && { arena_scorecard_ref: observed.arena_scorecard_ref }),
    external_truth: {
      expected_decision: expectedDecision,
      verifier_status_counts: countVerifierStatuses(observed.verifier_results),
      verifier_refs: verifierRefs,
    },
    arena: {
      observed_decision: observed.arena_decision,
      issue_count: issues.length,
      blocking_issue_count: blockingIssues.length,
      warning_count: warningIssues.length,
      risk_count: riskIssues.length,
      issues_without_evidence: issuesWithoutEvidence,
    },
    alignment: {
      score: alignmentScore,
      decision_agreement: decisionAgreement,
      false_pass: falsePass,
      false_blocking: falseBlocking,
      verifier_evidence_present: verifierEvidencePresent,
      issue_evidence_completeness: issueEvidenceCompleteness,
      warning_precision: warningPrecision,
    },
    overall: {
      score: alignmentScore,
      decision: overallDecision,
      ...(blockingFailure && { blocking_failure: blockingFailure }),
      recommendations,
    },
  };
}

export function writeArenaEffectivenessScorecard(
  observed: ArenaEffectivenessObservedRun,
  outputPath: string,
  options: { projectRoot?: string } = {},
): ArenaEffectivenessScorecard {
  const scorecard = scoreArenaEffectivenessObservedRun(observed, options);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(scorecard, null, 2)}\n`, 'utf-8');
  return scorecard;
}

function expectedArenaDecision(observed: ArenaEffectivenessObservedRun): ArenaDecision {
  const replayStatuses = (observed.replay_results || []).map(result => result.status);
  const replayPassCount = replayStatuses.filter(status => status === 'pass').length;
  const replayFailCount = replayStatuses.filter(status => status === 'fail').length;
  const replayBlockedCount = replayStatuses.filter(status => status === 'blocked').length;
  if (replayPassCount > 0 && replayFailCount + replayBlockedCount > 0) {
    return 'unstable';
  }
  const statuses = observed.verifier_results.map(result => result.status);
  if (observed.unsafe_observed || statuses.includes('unsafe')) {
    return 'unsafe';
  }
  if (statuses.length === 0 || statuses.every(status => status === 'blocked')) {
    return 'blocked';
  }
  const passCount = statuses.filter(status => status === 'pass').length;
  const failCount = statuses.filter(status => status === 'fail').length;
  const blockedCount = statuses.filter(status => status === 'blocked').length;
  if (passCount > 0 && (failCount > 0 || blockedCount > 0)) {
    return 'unstable';
  }
  if (failCount > 0 && passCount === 0) {
    return 'reopened';
  }
  if (passCount > 0 && failCount === 0 && blockedCount === 0) {
    return 'pass';
  }
  return 'blocked';
}

function scoreAlignment(input: {
  decisionAgreement: boolean;
  falsePass: boolean;
  falseBlocking: boolean;
  verifierEvidencePresent: boolean;
  issueEvidenceCompleteness: number;
  warningPrecision: number;
}): number {
  const decisionScore = input.decisionAgreement ? 45 : 0;
  const falsePassScore = input.falsePass ? 0 : 20;
  const falseBlockingScore = input.falseBlocking ? 0 : 15;
  const verifierScore = input.verifierEvidencePresent ? 10 : 0;
  const issueEvidenceScore = 5 * input.issueEvidenceCompleteness;
  const warningScore = 5 * input.warningPrecision;
  return clampScore(decisionScore + falsePassScore + falseBlockingScore + verifierScore + issueEvidenceScore + warningScore);
}

function buildRecommendations(input: {
  expectedDecision: ArenaDecision;
  observedDecision: ArenaDecision;
  falsePass: boolean;
  falseBlocking: boolean;
  verifierEvidencePresent: boolean;
  issueEvidenceCompleteness: number;
  warningPrecision: number;
  issuesWithoutEvidence: string[];
}): string[] {
  const recommendations: string[] = [];
  if (input.expectedDecision !== input.observedDecision) {
    recommendations.push(`Arena decision should be ${input.expectedDecision}, got ${input.observedDecision}.`);
  }
  if (input.falsePass) {
    recommendations.push('Arena false-passed a verifier non-pass outcome; this is release-blocking for Arena effectiveness.');
  }
  if (input.falseBlocking) {
    recommendations.push('Arena converted verifier pass into reopened/blocked without accepted unsafe or instability evidence.');
  }
  if (!input.verifierEvidencePresent) {
    recommendations.push('Arena effectiveness scorecard needs verifier result refs as external truth evidence.');
  }
  if (input.issueEvidenceCompleteness < 1) {
    recommendations.push(`Arena issues missing evidence refs: ${input.issuesWithoutEvidence.join(', ')}.`);
  }
  if (input.warningPrecision < 1) {
    recommendations.push('Arena warning/risk issues need evidence refs and must not be upgraded to blocking without proof.');
  }
  return uniqueStrings(recommendations);
}

function countVerifierStatuses(results: ArenaEffectivenessVerifierResult[]): Record<ArenaVerifierStatus, number> {
  return {
    pass: results.filter(result => result.status === 'pass').length,
    fail: results.filter(result => result.status === 'fail').length,
    blocked: results.filter(result => result.status === 'blocked').length,
    unsafe: results.filter(result => result.status === 'unsafe').length,
  };
}

function ratio(numerator: number, denominator: number, emptyValue: number): number {
  if (denominator === 0) {
    return emptyValue;
  }
  return Number((numerator / denominator).toFixed(3));
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function relativeRef(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join('/');
}
