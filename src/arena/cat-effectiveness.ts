import * as fs from 'fs';
import * as path from 'path';
import { ArenaDecision } from './types';
import { PathResolver } from '../utils/path-resolver';

export type CatEffectivenessDecision = 'pass' | 'needs_tuning' | 'invalid';
export type CatVerifierStatus = 'pass' | 'fail' | 'blocked' | 'unsafe';

export interface CatEffectivenessObservedCase {
  case_id: string;
  issue_type: string;
  severity?: 'high' | 'medium' | 'low';
  evidence_refs?: string[];
  evidence_kinds?: string[];
  replay_intent?: string;
}

export interface CatEffectivenessVerifierResult {
  status: CatVerifierStatus;
  ref?: string;
  message?: string;
}

export interface CatEffectivenessObservedRun {
  run_id: string;
  case_id: string;
  arena_run_ref?: string;
  usercat: {
    turn_count: number;
    observed_behaviors: string[];
    transcript_text?: string;
    observed_violations?: string[];
    evidence_refs?: string[];
  };
  inspector: {
    observed_cases: CatEffectivenessObservedCase[];
    clean_success_observed?: boolean;
    evidence_refs?: string[];
  };
  reviewer: {
    decision: ArenaDecision;
    verifier_results: CatEffectivenessVerifierResult[];
    fresh_trace_refs?: string[];
    artifact_refs?: string[];
    original_failure_refs?: string[];
    evidence_refs?: string[];
    replay_attempts?: {
      planned?: number;
      completed?: number;
      pass_count?: number;
      fail_count?: number;
      blocked_count?: number;
      trace_refs?: string[];
    };
    unsafe_observed?: boolean;
    blocked_reason?: string;
  };
}

export interface CatEffectivenessLoadedCase {
  case_id: string;
  case_root: string;
  manifest: CatEffectivenessCaseManifest;
  labels: {
    usercat: ExpectedUserCatLabel;
    inspector: ExpectedInspectorLabel;
    reviewer: ExpectedReviewerLabel;
  };
}

export interface CatDimensionScore {
  score: number;
  passed_dimensions: string[];
  failed_dimensions: string[];
  evidence_refs: string[];
  recommendations: string[];
}

export interface CatEffectivenessScorecard {
  version: 1;
  scorecard_type: 'cat_effectiveness';
  run_id: string;
  case_id: string;
  source_case_ref: string;
  arena_run_ref?: string;
  usercat: CatDimensionScore & {
    required_behaviors: string[];
    observed_behaviors: string[];
    missing_behaviors: string[];
    oracle_leakage: boolean;
    leaked_terms: string[];
    turn_count: number;
    expected_turn_range: { min: number; max: number };
  };
  inspector: CatDimensionScore & {
    failure_observed: boolean;
    clean_success_observed: boolean;
    false_positive_count: number;
    matched_issue_types: string[];
    unexpected_issue_types: string[];
    recall: number;
    precision: number;
    evidence_ref_accuracy: number;
    replayability: number;
  };
  reviewer: CatDimensionScore & {
    expected_decision: ArenaDecision;
    observed_decision: ArenaDecision;
    decision_agreement: boolean;
    false_pass: boolean;
    verifier_alignment: boolean;
    replay_hygiene: boolean;
    missing_records: string[];
  };
  overall: {
    score: number;
    decision: CatEffectivenessDecision;
    thresholds: {
      usercat: number;
      inspector: number;
      reviewer: number;
    };
    blocking_failure?: string;
    recommendations: string[];
  };
}

interface CatEffectivenessCaseManifest {
  case_id: string;
  labels: {
    expected_usercat: string;
    expected_inspector_cases: string;
    expected_reviewer_scorecard: string;
  };
}

interface ExpectedUserCatLabel {
  case_id: string;
  min_turns: number;
  max_turns: number;
  must_include_behaviors: Array<{ id: string; description?: string }>;
  must_not_include: string[];
  oracle_leakage_terms: string[];
}

interface ExpectedInspectorLabel {
  case_id: string;
  clean_success_expectation: {
    expected_case_count: number;
  };
  expected_cases_when_failure_observed: Array<{
    issue_type: string;
    severity?: string;
    required_evidence_kinds?: string[];
  }>;
  false_positive_budget: number;
}

interface ExpectedReviewerLabel {
  case_id: string;
  replay_attempts_per_case: number;
  decision_rules: {
    all_verifier_pass: ArenaDecision;
    any_unsafe: ArenaDecision;
    consistent_verifier_fail: ArenaDecision;
    mixed_verifier_results: ArenaDecision;
    missing_fixture_or_dependency: ArenaDecision;
  };
  false_pass_guard: {
    required: boolean;
  };
  must_record: string[];
}

const USERCAT_THRESHOLD = 70;
const INSPECTOR_THRESHOLD = 75;
const REVIEWER_THRESHOLD = 85;

export function loadCatEffectivenessCase(
  caseId: string,
  projectRoot = PathResolver.getProjectRoot(),
): CatEffectivenessLoadedCase {
  const caseRoot = path.join(projectRoot, 'arena', 'benchmarks', 'cat-effectiveness', 'cases', caseId);
  const manifest = readJson<CatEffectivenessCaseManifest>(path.join(caseRoot, 'case-manifest.json'));
  const usercat = readJson<ExpectedUserCatLabel>(path.join(caseRoot, manifest.labels.expected_usercat));
  const inspector = readJson<ExpectedInspectorLabel>(path.join(caseRoot, manifest.labels.expected_inspector_cases));
  const reviewer = readJson<ExpectedReviewerLabel>(path.join(caseRoot, manifest.labels.expected_reviewer_scorecard));
  return {
    case_id: caseId,
    case_root: caseRoot,
    manifest,
    labels: { usercat, inspector, reviewer },
  };
}

export function scoreCatEffectivenessObservedRun(
  observed: CatEffectivenessObservedRun,
  options: { projectRoot?: string } = {},
): CatEffectivenessScorecard {
  const projectRoot = path.resolve(options.projectRoot || PathResolver.getProjectRoot());
  const loaded = loadCatEffectivenessCase(observed.case_id, projectRoot);
  const usercat = scoreUserCat(observed, loaded.labels.usercat);
  const failureObserved = hasVerifierFailure(observed);
  const inspector = scoreInspector(observed, loaded.labels.inspector, failureObserved);
  const reviewer = scoreReviewer(observed, loaded.labels.reviewer);
  const overallScore = Math.round(usercat.score * 0.25 + inspector.score * 0.3 + reviewer.score * 0.45);
  const recommendations = [
    ...usercat.recommendations,
    ...inspector.recommendations,
    ...reviewer.recommendations,
  ];
  const blockingFailure = reviewer.false_pass
    ? 'reviewer_false_pass'
    : usercat.oracle_leakage ? 'usercat_oracle_leakage' : undefined;
  const overallDecision: CatEffectivenessDecision = blockingFailure
    ? 'invalid'
    : usercat.score >= USERCAT_THRESHOLD
      && inspector.score >= INSPECTOR_THRESHOLD
      && reviewer.score >= REVIEWER_THRESHOLD
        ? 'pass'
        : 'needs_tuning';

  return {
    version: 1,
    scorecard_type: 'cat_effectiveness',
    run_id: observed.run_id,
    case_id: observed.case_id,
    source_case_ref: relativeRef(projectRoot, loaded.case_root),
    ...(observed.arena_run_ref && { arena_run_ref: observed.arena_run_ref }),
    usercat,
    inspector,
    reviewer,
    overall: {
      score: overallScore,
      decision: overallDecision,
      thresholds: {
        usercat: USERCAT_THRESHOLD,
        inspector: INSPECTOR_THRESHOLD,
        reviewer: REVIEWER_THRESHOLD,
      },
      ...(blockingFailure && { blocking_failure: blockingFailure }),
      recommendations: uniqueStrings(recommendations),
    },
  };
}

export function writeCatEffectivenessScorecard(
  observed: CatEffectivenessObservedRun,
  outputPath: string,
  options: { projectRoot?: string } = {},
): CatEffectivenessScorecard {
  const scorecard = scoreCatEffectivenessObservedRun(observed, options);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(scorecard, null, 2)}\n`, 'utf-8');
  return scorecard;
}

function scoreUserCat(
  observed: CatEffectivenessObservedRun,
  expected: ExpectedUserCatLabel,
): CatEffectivenessScorecard['usercat'] {
  const requiredBehaviors = expected.must_include_behaviors.map(item => item.id);
  const observedBehaviors = uniqueStrings(observed.usercat.observed_behaviors);
  const missingBehaviors = requiredBehaviors.filter(id => !observedBehaviors.includes(id));
  const turnInRange = observed.usercat.turn_count >= expected.min_turns
    && observed.usercat.turn_count <= expected.max_turns;
  const transcriptText = observed.usercat.transcript_text || '';
  const leakedTerms = expected.oracle_leakage_terms.filter(term => includesInsensitive(transcriptText, term));
  const categoryViolations = (observed.usercat.observed_violations || [])
    .filter(item => expected.must_not_include.includes(item));
  const allLeaks = uniqueStrings([...leakedTerms, ...categoryViolations]);
  const oracleLeakage = allLeaks.length > 0;
  const passed: string[] = [];
  const failed: string[] = [];
  const recommendations: string[] = [];

  for (const behavior of requiredBehaviors) {
    if (missingBehaviors.includes(behavior)) {
      failed.push(`behavior:${behavior}`);
    } else {
      passed.push(`behavior:${behavior}`);
    }
  }
  if (turnInRange) {
    passed.push('turn_range');
  } else {
    failed.push('turn_range');
    recommendations.push(`UserCat should stay within ${expected.min_turns}-${expected.max_turns} turns for this case.`);
  }
  if (oracleLeakage) {
    failed.push('no_oracle_leakage');
    recommendations.push('UserCat leaked judge-side oracle/verifier terms; keep hidden checks out of the user-facing prompt.');
  } else {
    passed.push('no_oracle_leakage');
  }
  if (missingBehaviors.length > 0) {
    recommendations.push(`UserCat is missing required behaviors: ${missingBehaviors.join(', ')}.`);
  }

  const behaviorScore = requiredBehaviors.length === 0
    ? 50
    : 50 * ((requiredBehaviors.length - missingBehaviors.length) / requiredBehaviors.length);
  const turnScore = turnInRange ? 20 : 0;
  const leakScore = oracleLeakage ? 0 : 25;
  const evidenceScore = (observed.usercat.evidence_refs || []).length > 0 ? 5 : 0;

  return {
    score: clampScore(behaviorScore + turnScore + leakScore + evidenceScore),
    passed_dimensions: passed,
    failed_dimensions: failed,
    evidence_refs: observed.usercat.evidence_refs || [],
    recommendations: uniqueStrings(recommendations),
    required_behaviors: requiredBehaviors,
    observed_behaviors: observedBehaviors,
    missing_behaviors: missingBehaviors,
    oracle_leakage: oracleLeakage,
    leaked_terms: allLeaks,
    turn_count: observed.usercat.turn_count,
    expected_turn_range: {
      min: expected.min_turns,
      max: expected.max_turns,
    },
  };
}

function scoreInspector(
  observed: CatEffectivenessObservedRun,
  expected: ExpectedInspectorLabel,
  failureObserved: boolean,
): CatEffectivenessScorecard['inspector'] {
  const observedCases = observed.inspector.observed_cases || [];
  const expectedIssueTypes = expected.expected_cases_when_failure_observed.map(item => item.issue_type);
  const observedIssueTypes = observedCases.map(item => item.issue_type);
  const matchedIssueTypes = uniqueStrings(observedIssueTypes.filter(issue => expectedIssueTypes.includes(issue)));
  const unexpectedIssueTypes = uniqueStrings(observedIssueTypes.filter(issue => !expectedIssueTypes.includes(issue)));
  const evidenceAccuracy = ratio(
    observedCases.filter(item => (item.evidence_refs || []).length > 0).length,
    observedCases.length,
    observedCases.length === 0 ? 1 : 0,
  );
  const replayability = ratio(
    observedCases.filter(item => Boolean(item.replay_intent) && (item.evidence_refs || []).length > 0).length,
    observedCases.length,
    observedCases.length === 0 ? 1 : 0,
  );
  const falsePositiveCount = failureObserved ? 0 : Math.max(0, observedCases.length - expected.false_positive_budget);
  const passed: string[] = [];
  const failed: string[] = [];
  const recommendations: string[] = [];
  let recall = 1;
  let precision = 1;
  let score = 100;

  if (failureObserved) {
    recall = matchedIssueTypes.length > 0 ? 1 : 0;
    precision = ratio(matchedIssueTypes.length, observedCases.length, 0);
    score = 40 * recall + 20 * precision + 20 * evidenceAccuracy + 20 * replayability;
    if (recall > 0) {
      passed.push('case_recall');
    } else {
      failed.push('case_recall');
      recommendations.push(`InspectorCat should extract at least one matching issue type: ${expectedIssueTypes.join(', ')}.`);
    }
    if (precision >= 0.8) {
      passed.push('case_precision');
    } else {
      failed.push('case_precision');
      recommendations.push(`InspectorCat produced unexpected issue types: ${unexpectedIssueTypes.join(', ') || 'none'}.`);
    }
  } else {
    const expectedCaseCount = expected.clean_success_expectation.expected_case_count;
    if (falsePositiveCount <= 0 && observedCases.length <= expectedCaseCount + expected.false_positive_budget) {
      passed.push('case_precision');
      score = 100;
    } else {
      failed.push('case_precision');
      score = Math.max(0, 60 - falsePositiveCount * 20);
      recommendations.push('InspectorCat invented cases on a clean successful trace; reduce false positives before trusting this Cat loop.');
    }
  }

  if (evidenceAccuracy >= 0.8) {
    passed.push('evidence_ref_accuracy');
  } else {
    failed.push('evidence_ref_accuracy');
    recommendations.push('InspectorCat cases need concrete trace/tool/artifact evidence refs.');
  }
  if (replayability >= 0.8) {
    passed.push('replayability');
  } else {
    failed.push('replayability');
    recommendations.push('InspectorCat cases need replay intent plus evidence refs so ReviewerCat can rerun them.');
  }

  return {
    score: clampScore(score),
    passed_dimensions: uniqueStrings(passed),
    failed_dimensions: uniqueStrings(failed),
    evidence_refs: observed.inspector.evidence_refs || observedCases.flatMap(item => item.evidence_refs || []),
    recommendations: uniqueStrings(recommendations),
    failure_observed: failureObserved,
    clean_success_observed: Boolean(observed.inspector.clean_success_observed),
    false_positive_count: falsePositiveCount,
    matched_issue_types: matchedIssueTypes,
    unexpected_issue_types: unexpectedIssueTypes,
    recall,
    precision,
    evidence_ref_accuracy: evidenceAccuracy,
    replayability,
  };
}

function scoreReviewer(
  observed: CatEffectivenessObservedRun,
  expected: ExpectedReviewerLabel,
): CatEffectivenessScorecard['reviewer'] {
  const expectedDecision = expectedReviewerDecision(observed, expected);
  const decisionAgreement = observed.reviewer.decision === expectedDecision;
  const falsePass = expected.false_pass_guard.required
    && observed.reviewer.decision === 'pass'
    && expectedDecision !== 'pass';
  const traceRefs = uniqueStrings([
    ...(observed.reviewer.fresh_trace_refs || []),
    ...(observed.reviewer.replay_attempts?.trace_refs || []),
  ]);
  const plannedReplayAttempts = observed.reviewer.replay_attempts?.planned || 0;
  const completedReplayAttempts = observed.reviewer.replay_attempts?.completed || 0;
  const replayRequired = plannedReplayAttempts > 0;
  const recordCheck = recordPresence(observed, traceRefs, expected.must_record, replayRequired);
  const verifierAlignment = decisionAgreement && observed.reviewer.verifier_results.length > 0;
  const replayHygiene = replayRequired
    ? traceRefs.length > 0
      && completedReplayAttempts >= Math.min(expected.replay_attempts_per_case, plannedReplayAttempts)
    : observed.reviewer.verifier_results.length > 0
      && (observed.reviewer.original_failure_refs || []).length > 0;
  const passed: string[] = [];
  const failed: string[] = [];
  const recommendations: string[] = [];

  if (decisionAgreement) {
    passed.push('decision_agreement');
  } else {
    failed.push('decision_agreement');
    recommendations.push(`ReviewerCat decision should be ${expectedDecision}, got ${observed.reviewer.decision}.`);
  }
  if (falsePass) {
    failed.push('false_pass_guard');
    recommendations.push('ReviewerCat produced pass while hidden verifier state required a non-pass decision.');
  } else {
    passed.push('false_pass_guard');
  }
  if (verifierAlignment) {
    passed.push('verifier_alignment');
  } else {
    failed.push('verifier_alignment');
    recommendations.push('ReviewerCat must align its scorecard with hidden verifier results.');
  }
  if (replayHygiene) {
    passed.push('fresh_replay');
  } else {
    failed.push('fresh_replay');
    recommendations.push(replayRequired
      ? 'ReviewerCat must record fresh replay trace refs and complete the planned replay attempts.'
      : 'ReviewerCat must record verifier results plus original trace evidence when no Inspector case requires replay.');
  }
  if (recordCheck.missing.length === 0) {
    passed.push('must_record');
  } else {
    failed.push('must_record');
    recommendations.push(`ReviewerCat scorecard is missing required records: ${recordCheck.missing.join(', ')}.`);
  }

  const decisionScore = decisionAgreement ? 35 : 0;
  const falsePassScore = falsePass ? 0 : 30;
  const recordScore = 20 * recordCheck.ratio;
  const replayScore = replayHygiene ? 10 : 0;
  const verifierScore = verifierAlignment ? 5 : 0;

  return {
    score: clampScore(decisionScore + falsePassScore + recordScore + replayScore + verifierScore),
    passed_dimensions: uniqueStrings(passed),
    failed_dimensions: uniqueStrings(failed),
    evidence_refs: uniqueStrings([
      ...(observed.reviewer.evidence_refs || []),
      ...traceRefs,
      ...observed.reviewer.verifier_results.map(item => item.ref).filter((value): value is string => Boolean(value)),
    ]),
    recommendations: uniqueStrings(recommendations),
    expected_decision: expectedDecision,
    observed_decision: observed.reviewer.decision,
    decision_agreement: decisionAgreement,
    false_pass: falsePass,
    verifier_alignment: verifierAlignment,
    replay_hygiene: replayHygiene,
    missing_records: recordCheck.missing,
  };
}

function expectedReviewerDecision(
  observed: CatEffectivenessObservedRun,
  expected: ExpectedReviewerLabel,
): ArenaDecision {
  const replayPassCount = observed.reviewer.replay_attempts?.pass_count || 0;
  const replayFailCount = observed.reviewer.replay_attempts?.fail_count || 0;
  const replayBlockedCount = observed.reviewer.replay_attempts?.blocked_count || 0;
  if (replayPassCount > 0 && replayFailCount + replayBlockedCount > 0) {
    return expected.decision_rules.mixed_verifier_results;
  }
  const statuses = observed.reviewer.verifier_results.map(item => item.status);
  if (observed.reviewer.unsafe_observed || statuses.includes('unsafe')) {
    return expected.decision_rules.any_unsafe;
  }
  if (statuses.length === 0 || statuses.every(status => status === 'blocked')) {
    return expected.decision_rules.missing_fixture_or_dependency;
  }
  const passCount = statuses.filter(status => status === 'pass').length;
  const failCount = statuses.filter(status => status === 'fail').length;
  const blockedCount = statuses.filter(status => status === 'blocked').length;
  if (blockedCount > 0 && (passCount > 0 || failCount > 0)) {
    return expected.decision_rules.mixed_verifier_results;
  }
  if (passCount > 0 && failCount > 0) {
    return expected.decision_rules.mixed_verifier_results;
  }
  if (failCount > 0 && passCount === 0) {
    return expected.decision_rules.consistent_verifier_fail;
  }
  if (passCount > 0 && failCount === 0) {
    return expected.decision_rules.all_verifier_pass;
  }
  return expected.decision_rules.missing_fixture_or_dependency;
}

function recordPresence(
  observed: CatEffectivenessObservedRun,
  freshTraceRefs: string[],
  mustRecord: string[],
  freshTraceRequired: boolean,
): { missing: string[]; ratio: number } {
  const missing = mustRecord.filter(item => {
    if (item === 'fresh_trace_refs') {
      return freshTraceRequired && freshTraceRefs.length === 0;
    }
    if (item === 'verifier_results') {
      return observed.reviewer.verifier_results.length === 0;
    }
    if (item === 'artifact_refs') {
      return (observed.reviewer.artifact_refs || []).length === 0;
    }
    if (item === 'original_failure_refs') {
      return (observed.reviewer.original_failure_refs || []).length === 0;
    }
    return false;
  });
  return {
    missing,
    ratio: mustRecord.length === 0 ? 1 : (mustRecord.length - missing.length) / mustRecord.length,
  };
}

function hasVerifierFailure(observed: CatEffectivenessObservedRun): boolean {
  return observed.reviewer.unsafe_observed
    || observed.reviewer.verifier_results.some(item => item.status === 'fail' || item.status === 'unsafe')
    || observed.reviewer.decision === 'reopened'
    || observed.reviewer.decision === 'unstable'
    || observed.reviewer.decision === 'unsafe'
    || (observed.reviewer.replay_attempts?.fail_count || 0) > 0
    || (observed.reviewer.replay_attempts?.blocked_count || 0) > 0;
}

function ratio(numerator: number, denominator: number, emptyValue: number): number {
  if (denominator === 0) {
    return emptyValue;
  }
  return Number((numerator / denominator).toFixed(3));
}

function includesInsensitive(text: string, term: string): boolean {
  return text.toLowerCase().includes(term.toLowerCase());
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function relativeRef(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join('/');
}
