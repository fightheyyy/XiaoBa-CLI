#!/usr/bin/env tsx

import * as path from 'path';
import { runEvalBenchmark, writeEvalBenchmarkScorecard } from '../src/eval';

interface CliOptions {
  outDir?: string;
  allowFail: boolean;
}

const BASE_RUNTIME_BENCHMARK_PATH = path.resolve('eval/benchmarks/BaseRuntime/benchmark.json');

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const scorecard = writeEvalBenchmarkScorecard(await runEvalBenchmark({
    benchmarkPath: BASE_RUNTIME_BENCHMARK_PATH,
    outDir: options.outDir,
  }));

  console.log([
    `Eval benchmark complete: ${scorecard.summary.decision}`,
    `benchmark=${scorecard.benchmark_id}`,
    `benchmarkCases=${scorecard.summary.benchmark_cases_passed}/${scorecard.summary.benchmark_cases_total} passed`,
    `evalCases=${scorecard.summary.eval_cases_passed}/${scorecard.summary.eval_cases_total} passed`,
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
  let allowFail = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--out') {
      outDir = path.resolve(readNext(args, ++index, '--out'));
      continue;
    }
    if (arg === '--allow-fail') {
      allowFail = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`unknown option: ${arg}`);
  }

  return { outDir, allowFail };
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
    'Usage: npm run eval:base-runtime -- [--out <dir>] [--allow-fail]',
    '',
    'Runs the BaseRuntime live agent eval benchmark and writes manifest.json, scorecard.json, and report.md.',
    '',
    'Default benchmark: eval/benchmarks/BaseRuntime/benchmark.json',
  ].join('\n'));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
