#!/usr/bin/env tsx

import * as path from 'path';
import {
  runEvalGate,
  writeEvalGateScorecard,
  type EvalGateProfile,
} from '../src/eval';
import { getObservability } from '../src/observability';

interface CliOptions {
  outDir?: string;
  profile: EvalGateProfile;
  allowFail: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const observability = getObservability();
  const span = observability.startSpan('xiaoba.eval.gate', {
    'xiaoba.eval.out_dir': options.outDir || 'output/eval-gate',
    'xiaoba.eval.profile': options.profile,
  });
  const scorecard = writeEvalGateScorecard(await runEvalGate({
    outDir: options.outDir,
    profile: options.profile,
  }));
  const attrs = {
    'xiaoba.eval.decision': scorecard.summary.decision,
    'xiaoba.eval.profile': scorecard.gate_profile,
    'xiaoba.eval.items_total': scorecard.summary.items_total,
    'xiaoba.eval.items_passed': scorecard.summary.items_passed,
    'xiaoba.eval.cases_total': scorecard.summary.cases_total,
    'xiaoba.eval.cases_passed': scorecard.summary.cases_passed,
    'xiaoba.eval.hard_failures': scorecard.summary.hard_failures,
  };
  observability.recordMetric('xiaoba.eval.gate.result', 1, attrs);
  observability.recordLog(
    'xiaoba.eval.gate.result',
    attrs,
    scorecard.summary.decision === 'pass' ? 'INFO' : 'ERROR',
    span.context,
  );
  observability.endSpan(span, {
    status: scorecard.summary.decision === 'pass' ? 'ok' : 'error',
    message: scorecard.summary.decision,
    attributes: attrs,
  });

  console.log([
    `Eval gate complete: ${scorecard.summary.decision}`,
    `profile=${scorecard.gate_profile}`,
    `items=${scorecard.summary.items_passed}/${scorecard.summary.items_total} passed`,
    `cases=${scorecard.summary.cases_passed}/${scorecard.summary.cases_total} passed`,
    `hardFailures=${scorecard.summary.hard_failures}`,
    `scorecard=${scorecard.evidence.scorecard_path}`,
    `report=${scorecard.evidence.report_path}`,
  ].join('\n'));

  if (!options.allowFail && scorecard.summary.decision !== 'pass') {
    process.exit(1);
  }
}

function parseArgs(args: string[]): CliOptions {
  let outDir: string | undefined;
  let profile: EvalGateProfile = 'live-agent-eval';
  let allowFail = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--out') {
      outDir = path.resolve(readNext(args, ++index, '--out'));
      continue;
    }
    if (arg === '--profile') {
      profile = parseProfile(readNext(args, ++index, '--profile'));
      continue;
    }
    if (arg === '--allow-fail') {
      allowFail = true;
      continue;
    }
    if (arg === '--live-agent-eval-only') {
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`unknown option: ${arg}`);
  }

  return { outDir, profile, allowFail };
}

function parseProfile(value: string): EvalGateProfile {
  if (value === 'live-agent-eval') {
    return value;
  }
  if (value === 'runtime-harness') {
    throw new Error('eval:gate only runs live agent eval. Use test:contract-smoke for runtime-harness checks.');
  }
  throw new Error(`unknown live agent eval gate profile: ${value}`);
}

function readNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printHelp(): void {
  console.log([
    'Usage: tsx scripts/run-eval-gate.ts -- [--profile live-agent-eval] [--out <dir>] [--allow-fail] [--live-agent-eval-only]',
    '',
    'Runs the XiaoBa live agent eval gate and writes manifest.json, scorecard.json, and report.md.',
    '',
    'Default output: output/eval-gate/<timestamp>',
  ].join('\n'));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
