import * as fs from 'fs';
import * as path from 'path';
import {
  runEvalBenchmark,
  writeEvalBenchmarkScorecard,
  type EvalBenchmarkScorecard,
} from './benchmark-bridge';
import type { EvalDecision } from './types';

export type EvalGateItemKind = 'benchmark';
export type EvalGateProfile = 'live-agent-eval';

export interface EvalGateOptions {
  outDir?: string;
  now?: Date;
  profile?: EvalGateProfile;
  items?: EvalGateItem[];
}

export interface EvalGateItem {
  id: string;
  name: string;
  kind: EvalGateItemKind;
  path: string;
  out_subdir: string;
}

export interface EvalGateItemResult {
  id: string;
  name: string;
  kind: EvalGateItemKind;
  decision: EvalDecision;
  path: string;
  cases_total: number;
  cases_passed: number;
  hard_failures: number;
  scorecard_path?: string;
  report_path?: string;
  message: string;
}

export interface EvalGateScorecard {
  scorecard_version: '0.1';
  gate_id: string;
  gate_name: string;
  gate_profile: EvalGateProfile;
  generated_at: string;
  summary: {
    decision: EvalDecision;
    items_total: number;
    items_passed: number;
    items_failed: number;
    items_blocked: number;
    cases_total: number;
    cases_passed: number;
    hard_failures: number;
    pass_rate: number;
  };
  scores: {
    quality: number;
    reliability: number;
    safety: number;
    efficiency: number;
  };
  items: EvalGateItemResult[];
  evidence: {
    out_dir: string;
    manifest_path?: string;
    scorecard_path?: string;
    report_path?: string;
  };
}

const LIVE_AGENT_EVAL_GATE_ITEMS: EvalGateItem[] = [
  {
    id: 'base-runtime-benchmark',
    name: 'BaseRuntime Live Agent Eval',
    kind: 'benchmark',
    path: 'eval/benchmarks/BaseRuntime/benchmark.json',
    out_subdir: 'benchmarks/base-runtime',
  },
];

export function getEvalGateItemsForProfile(profile: EvalGateProfile = 'live-agent-eval'): EvalGateItem[] {
  if (profile !== 'live-agent-eval') {
    throw new Error(`unsupported eval gate profile: ${profile}`);
  }
  return [...LIVE_AGENT_EVAL_GATE_ITEMS];
}

export async function runEvalGate(options: EvalGateOptions = {}): Promise<EvalGateScorecard> {
  const profile = options.profile ?? 'live-agent-eval';
  const now = options.now ?? new Date();
  const outDir = options.outDir ? path.resolve(options.outDir) : defaultGateOutDir(now, profile);
  const items = options.items ?? getEvalGateItemsForProfile(profile);
  fs.mkdirSync(outDir, { recursive: true });

  const results: EvalGateItemResult[] = [];
  const scores: Array<EvalBenchmarkScorecard['scores']> = [];

  for (const item of items) {
    const itemOutDir = path.join(outDir, item.out_subdir);
    try {
      const scorecard = writeEvalBenchmarkScorecard(await runEvalBenchmark({
        benchmarkPath: path.resolve(item.path),
        outDir: itemOutDir,
        now,
      }), itemOutDir);
      scores.push(scorecard.scores);
      results.push(benchmarkResult(item, scorecard));
    } catch (error) {
      results.push(blockedResult(item, error));
    }
  }

  return buildGateScorecard({
    now,
    outDir,
    profile,
    results,
    scores,
  });
}

export function writeEvalGateScorecard(
  scorecard: EvalGateScorecard,
  outDir = scorecard.evidence.out_dir,
): EvalGateScorecard {
  fs.mkdirSync(outDir, { recursive: true });
  const manifestPath = path.join(outDir, 'manifest.json');
  const scorecardPath = path.join(outDir, 'scorecard.json');
  const reportPath = path.join(outDir, 'report.md');

  const withPaths: EvalGateScorecard = {
    ...scorecard,
    evidence: {
      ...scorecard.evidence,
      out_dir: outDir,
      manifest_path: manifestPath,
      scorecard_path: scorecardPath,
      report_path: reportPath,
    },
  };

  fs.writeFileSync(manifestPath, `${JSON.stringify({
    gate_id: withPaths.gate_id,
    gate_profile: withPaths.gate_profile,
    generated_at: withPaths.generated_at,
    decision: withPaths.summary.decision,
    items_total: withPaths.summary.items_total,
    cases_total: withPaths.summary.cases_total,
  }, null, 2)}\n`, 'utf-8');
  fs.writeFileSync(scorecardPath, `${JSON.stringify(withPaths, null, 2)}\n`, 'utf-8');
  fs.writeFileSync(reportPath, `${renderEvalGateReport(withPaths)}\n`, 'utf-8');

  return withPaths;
}

export function renderEvalGateReport(scorecard: EvalGateScorecard): string {
  const itemRows = scorecard.items.map(item => [
    '|',
    item.id,
    '|',
    item.kind,
    '|',
    item.decision,
    '|',
    `${item.cases_passed}/${item.cases_total}`,
    '|',
    item.hard_failures,
    '|',
    item.scorecard_path ?? 'missing',
    '|',
  ].join(' '));

  return [
    `# Eval Gate Report: ${scorecard.gate_name}`,
    '',
    `- gate: ${scorecard.gate_id}`,
    `- profile: ${scorecard.gate_profile}`,
    `- generated at: ${scorecard.generated_at}`,
    `- decision: ${scorecard.summary.decision}`,
    `- items: ${scorecard.summary.items_passed}/${scorecard.summary.items_total} passed`,
    `- cases: ${scorecard.summary.cases_passed}/${scorecard.summary.cases_total} passed`,
    `- hard failures: ${scorecard.summary.hard_failures}`,
    `- quality: ${scorecard.scores.quality}`,
    `- reliability: ${scorecard.scores.reliability}`,
    `- safety: ${scorecard.scores.safety}`,
    `- efficiency: ${scorecard.scores.efficiency}`,
    '',
    '## Items',
    '',
    '| Item | Kind | Decision | Cases | Hard Failures | Scorecard |',
    '| --- | --- | --- | --- | --- | --- |',
    ...itemRows,
    '',
    '## Messages',
    '',
    ...scorecard.items.map(item => `- ${item.id}: ${item.message}`),
  ].join('\n');
}

function benchmarkResult(item: EvalGateItem, scorecard: EvalBenchmarkScorecard): EvalGateItemResult {
  return {
    id: item.id,
    name: item.name,
    kind: item.kind,
    decision: scorecard.summary.decision,
    path: path.resolve(item.path),
    cases_total: scorecard.summary.eval_cases_total,
    cases_passed: scorecard.summary.eval_cases_passed,
    hard_failures: scorecard.summary.hard_failures,
    scorecard_path: scorecard.evidence.scorecard_path,
    report_path: scorecard.evidence.report_path,
    message: `${scorecard.summary.benchmark_cases_passed}/${scorecard.summary.benchmark_cases_total} benchmark cases passed, ${scorecard.summary.eval_cases_passed}/${scorecard.summary.eval_cases_total} nested eval cases passed`,
  };
}

function blockedResult(item: EvalGateItem, error: unknown): EvalGateItemResult {
  return {
    id: item.id,
    name: item.name,
    kind: item.kind,
    decision: 'blocked',
    path: path.resolve(item.path),
    cases_total: 0,
    cases_passed: 0,
    hard_failures: 0,
    message: error instanceof Error ? error.message : String(error),
  };
}

function buildGateScorecard(input: {
  now: Date;
  outDir: string;
  profile: EvalGateProfile;
  results: EvalGateItemResult[];
  scores: Array<EvalBenchmarkScorecard['scores']>;
}): EvalGateScorecard {
  const itemsPassed = input.results.filter(item => item.decision === 'pass').length;
  const itemsFailed = input.results.filter(item => item.decision === 'fail').length;
  const itemsBlocked = input.results.filter(item => item.decision === 'blocked').length;
  const casesTotal = input.results.reduce((sum, item) => sum + item.cases_total, 0);
  const casesPassed = input.results.reduce((sum, item) => sum + item.cases_passed, 0);
  const hardFailures = input.results.reduce((sum, item) => sum + item.hard_failures, 0);
  const passRate = input.results.length > 0 ? itemsPassed / input.results.length : 0;

  return {
    scorecard_version: '0.1',
    gate_id: 'eval-gate',
    gate_name: gateNameForProfile(input.profile),
    gate_profile: input.profile,
    generated_at: input.now.toISOString(),
    summary: {
      decision: decideGate({ itemsFailed, itemsBlocked }),
      items_total: input.results.length,
      items_passed: itemsPassed,
      items_failed: itemsFailed,
      items_blocked: itemsBlocked,
      cases_total: casesTotal,
      cases_passed: casesPassed,
      hard_failures: hardFailures,
      pass_rate: roundScore(passRate),
    },
    scores: {
      quality: averageScore(input.scores.map(item => item.quality)),
      reliability: averageScore(input.scores.map(item => item.reliability)),
      safety: averageScore(input.scores.map(item => item.safety)),
      efficiency: averageScore(input.scores.map(item => item.efficiency)),
    },
    items: input.results,
    evidence: {
      out_dir: input.outDir,
    },
  };
}

function decideGate(input: { itemsFailed: number; itemsBlocked: number }): EvalDecision {
  if (input.itemsFailed > 0) return 'fail';
  if (input.itemsBlocked > 0) return 'blocked';
  return 'pass';
}

function gateNameForProfile(profile: EvalGateProfile): string {
  return 'XiaoBa Live Agent Eval Gate';
}

function defaultGateOutDir(now: Date, profile: EvalGateProfile): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.resolve(process.cwd(), 'output', 'eval-gate', profile, stamp);
}

function averageScore(values: number[]): number {
  if (values.length === 0) return 0;
  return roundScore(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}
