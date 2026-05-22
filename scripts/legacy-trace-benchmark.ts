#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  renderLegacyTraceDatasetCardMarkdown,
  renderLegacyTraceBenchmarkMarkdown,
  runLegacyTraceBenchmark,
} from '../src/harness/legacy-trace-benchmark';
import type { LegacyTraceFileInput } from '../src/harness/legacy-trace-benchmark';

interface CliOptions {
  source: string;
  outDir: string;
  maxCases?: number;
  includeText: boolean;
  keepSourcePaths: boolean;
  topic: string;
  sourceNote: string;
  theme: string;
}

const MAX_ZIP_BUFFER = 200 * 1024 * 1024;

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const sourcePath = path.resolve(options.source);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`source not found: ${sourcePath}`);
  }

  const files = options.keepSourcePaths
    ? readTraceFiles(sourcePath)
    : anonymizeTraceFilePaths(readTraceFiles(sourcePath));
  if (files.length === 0) {
    throw new Error(`no .jsonl trace files found under ${sourcePath}`);
  }

  const result = runLegacyTraceBenchmark(files, {
    sourceLabel: path.basename(sourcePath),
    benchmarkName: options.topic,
    domain: inferDomainFromTopic(options.topic),
    domainSubtype: inferDomainSubtypeFromTopic(options.topic),
    maxCases: options.maxCases,
    includeText: options.includeText,
  });

  fs.mkdirSync(options.outDir, { recursive: true });
  const benchmarkPath = path.join(options.outDir, 'benchmark.json');
  const readmePath = path.join(options.outDir, 'README.md');
  const summaryPath = path.join(options.outDir, 'summary.md');
  const casesPath = path.join(options.outDir, 'cases.jsonl');
  const episodesPath = path.join(options.outDir, 'episodes.jsonl');
  const datasetCardPath = path.join(options.outDir, 'dataset-card.md');

  fs.writeFileSync(benchmarkPath, `${JSON.stringify(result, null, 2)}\n`, 'utf-8');
  fs.writeFileSync(readmePath, `${renderBenchmarkReadme(result, options)}\n`, 'utf-8');
  fs.writeFileSync(summaryPath, `${renderLegacyTraceBenchmarkMarkdown(result)}\n`, 'utf-8');
  fs.writeFileSync(casesPath, `${result.cases.map(item => JSON.stringify(item)).join('\n')}\n`, 'utf-8');
  fs.writeFileSync(episodesPath, `${result.episodes.map(item => JSON.stringify(item)).join('\n')}\n`, 'utf-8');
  fs.writeFileSync(datasetCardPath, `${renderLegacyTraceDatasetCardMarkdown(result)}\n`, 'utf-8');

  console.log([
    `Legacy trace benchmark complete: ${result.summary.benchmarkScore}/100`,
    `files=${result.summary.files} episodes=${result.summary.episodes} turns=${result.summary.turnEntries} runtime=${result.summary.runtimeEntries}`,
    `tools=${result.summary.toolCalls} failures=${result.summary.toolFailures} successRate=${(result.summary.toolSuccessRate * 100).toFixed(2)}%`,
    `redactionHits=${result.summary.redactionHits} cases=${result.cases.length}`,
    `readme=${readmePath}`,
    `summary=${summaryPath}`,
    `datasetCard=${datasetCardPath}`,
    `benchmark=${benchmarkPath}`,
    `episodes=${episodesPath}`,
    `cases=${casesPath}`,
  ].join('\n'));
}

function parseArgs(args: string[]): CliOptions {
  let source = '';
  let outDir = '';
  let maxCases: number | undefined;
  let includeText = false;
  let keepSourcePaths = false;
  let topic = 'Legacy IM Runtime Trace';
  let sourceNote = '';
  let theme = 'Legacy XiaoBa IM-runtime sessions used to evaluate trace ingestion, context pressure, tool reliability, restore events, artifact delivery, platform command compatibility, and log hygiene.';

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--out') {
      outDir = path.resolve(readNext(args, ++index, '--out'));
      continue;
    }
    if (arg === '--max-cases') {
      maxCases = Number(readNext(args, ++index, '--max-cases'));
      if (!Number.isFinite(maxCases) || maxCases <= 0) {
        throw new Error('--max-cases must be a positive number');
      }
      continue;
    }
    if (arg === '--include-text') {
      includeText = true;
      continue;
    }
    if (arg === '--keep-source-paths') {
      keepSourcePaths = true;
      continue;
    }
    if (arg === '--topic') {
      topic = readNext(args, ++index, '--topic');
      continue;
    }
    if (arg === '--source-note') {
      sourceNote = readNext(args, ++index, '--source-note');
      continue;
    }
    if (arg === '--theme') {
      theme = readNext(args, ++index, '--theme');
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    }
    if (!source) {
      source = arg;
      continue;
    }
    throw new Error(`unexpected argument: ${arg}`);
  }

  if (!source) {
    printHelp();
    throw new Error('missing source zip or directory');
  }

  if (!outDir) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    outDir = path.resolve(process.cwd(), 'output', 'legacy-trace-benchmark', stamp);
  }

  return {
    source,
    outDir,
    maxCases,
    includeText,
    keepSourcePaths,
    topic,
    sourceNote: sourceNote || path.basename(source),
    theme,
  };
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
    'Usage: npm run benchmark:legacy-trace -- <sessions.zip|sessions-dir> [--out <dir>] [--topic <name>] [--source-note <text>] [--theme <text>] [--max-cases <n>] [--include-text]',
    '',
    'Reads XiaoBa legacy session JSONL traces, normalizes them into aggregate metrics,',
    'writes a redacted benchmark manifest, emits a markdown summary, and creates README.md.',
    '',
    'By default, case previews omit user/assistant text. Use --include-text only for local private review.',
    'By default, trace file paths are anonymized in outputs. Use --keep-source-paths only for local private debugging.',
  ].join('\n'));
}

function renderBenchmarkReadme(result: ReturnType<typeof runLegacyTraceBenchmark>, options: CliOptions): string {
  const issueList = Object.entries(result.summary.issueCounts)
    .slice(0, 8)
    .map(([name, count]) => `- ${name}: ${count}`)
    .join('\n') || '- none';
  const caseKinds = Array.from(new Set(result.cases.map(item => item.kind))).sort();
  const caseCategories = Object.entries(result.summary.caseCategoryDistribution)
    .map(([name, count]) => `${name}=${count}`)
    .join(', ') || 'none';

  return [
    `# ${options.topic}`,
    '',
    '## Source',
    '',
    options.sourceNote,
    '',
    'This benchmark stores normalized metrics and redacted case manifests only. It does not store the raw trace archive or raw chat text.',
    '',
    '## Theme',
    '',
    options.theme,
    '',
    '## Baseline',
    '',
    `- score: ${result.summary.benchmarkScore}/100`,
    `- date range: ${result.summary.dates.start || 'n/a'} to ${result.summary.dates.end || 'n/a'} (${result.summary.dates.count} days)`,
    `- platforms: ${Object.entries(result.summary.platforms).map(([name, count]) => `${name}=${count}`).join(', ') || 'none'}`,
    `- sessions: ${result.summary.sessions}, interactions: ${result.summary.interactions}`,
    `- episodes: ${result.summary.episodes}`,
    `- turns: ${result.summary.turnEntries}, runtime events: ${result.summary.runtimeEntries}`,
    `- turns/episode: avg ${result.summary.avgTurnsPerEpisode}, p50 ${result.summary.p50TurnsPerEpisode}, p90 ${result.summary.p90TurnsPerEpisode}`,
    `- tool calls/episode: avg ${result.summary.avgToolCallsPerEpisode}, p50 ${result.summary.p50ToolCallsPerEpisode}, p90 ${result.summary.p90ToolCallsPerEpisode}`,
    `- tokens/episode: avg ${result.summary.avgTokensPerEpisode}, p50 ${result.summary.p50TokensPerEpisode}, p90 ${result.summary.p90TokensPerEpisode}, max ${result.summary.maxTokensPerEpisode}`,
    `- tokens: ${result.summary.totalTokens} (${result.summary.promptTokens}+${result.summary.completionTokens})`,
    `- tool calls: ${result.summary.toolCalls}, failures: ${result.summary.toolFailures}, success rate: ${(result.summary.toolSuccessRate * 100).toFixed(2)}%`,
    `- generated cases: ${result.cases.length}`,
    `- case categories: ${caseCategories}`,
    `- redaction hits: ${result.summary.redactionHits}`,
    '',
    '## Case Kinds',
    '',
    ...(caseKinds.length > 0 ? caseKinds.map(kind => `- ${kind}`) : ['- none']),
    '',
    '## Top Issues',
    '',
    issueList,
    '',
    '## Files',
    '',
    '- `benchmark.json`: full normalized benchmark manifest.',
    '- `episodes.jsonl`: one extracted episode per line.',
    '- `cases.jsonl`: one generated benchmark case per line.',
    '- `dataset-card.md`: episode-level dataset statistics.',
    '- `summary.md`: generated aggregate summary for quick reading.',
    '',
    '## Notes',
    '',
    '- Source file paths inside generated artifacts are anonymized unless the CLI is run with `--keep-source-paths`.',
    options.includeText
      ? '- `--include-text` was used, so cases may include redacted user/assistant previews for local review.'
      : '- `--include-text` was not used for this catalog artifact, so cases do not include user/assistant previews.',
  ].join('\n');
}

function inferDomainFromTopic(topic: string): string {
  return /bio|生信|seurat|single.cell/i.test(topic) ? 'bioinformatics' : 'general';
}

function inferDomainSubtypeFromTopic(topic: string): string {
  return /bio|生信|seurat|single.cell/i.test(topic) ? 'single_cell_seurat' : 'legacy_runtime_trace';
}

function readTraceFiles(sourcePath: string): LegacyTraceFileInput[] {
  const stats = fs.statSync(sourcePath);
  if (stats.isDirectory()) {
    return readDirectoryTraceFiles(sourcePath);
  }
  if (/\.zip$/i.test(sourcePath)) {
    return readZipTraceFiles(sourcePath);
  }
  if (/\.jsonl$/i.test(sourcePath)) {
    return [{
      path: path.basename(sourcePath),
      content: fs.readFileSync(sourcePath, 'utf-8'),
      sizeBytes: stats.size,
    }];
  }
  throw new Error(`unsupported source type: ${sourcePath}`);
}

function anonymizeTraceFilePaths(files: LegacyTraceFileInput[]): LegacyTraceFileInput[] {
  const counters = new Map<string, number>();
  return files
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(file => {
      const metadata = inferPathMetadata(file.path);
      const key = `${metadata.platform}/${metadata.date}`;
      const next = (counters.get(key) || 0) + 1;
      counters.set(key, next);
      const filename = `trace-${String(next).padStart(4, '0')}.jsonl`;
      return {
        ...file,
        path: `sessions/${metadata.platform}/${metadata.date || 'unknown-date'}/${filename}`,
      };
    });
}

function inferPathMetadata(inputPath: string): { platform: string; date: string } {
  const normalized = inputPath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const sessionsIndex = parts.lastIndexOf('sessions');
  const platform = sessionsIndex >= 0 && parts[sessionsIndex + 1]
    ? parts[sessionsIndex + 1]
    : 'unknown';
  const maybeDate = sessionsIndex >= 0 ? parts[sessionsIndex + 2] : '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(maybeDate || '') ? maybeDate : '';
  return { platform, date };
}

function readDirectoryTraceFiles(root: string): LegacyTraceFileInput[] {
  const files: LegacyTraceFileInput[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!entry.isFile() || !/\.jsonl$/i.test(entry.name)) {
        continue;
      }
      const stat = fs.statSync(absolute);
      files.push({
        path: path.relative(root, absolute).replace(/\\/g, '/'),
        content: fs.readFileSync(absolute, 'utf-8'),
        sizeBytes: stat.size,
      });
    }
  };
  visit(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function readZipTraceFiles(zipPath: string): LegacyTraceFileInput[] {
  const entries = execFileSync('unzip', ['-Z1', zipPath], {
    encoding: 'utf-8',
    maxBuffer: MAX_ZIP_BUFFER,
  })
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /\.jsonl$/i.test(line));

  return entries.map(entry => {
    const content = execFileSync('unzip', ['-p', zipPath, entry], {
      encoding: 'utf-8',
      maxBuffer: MAX_ZIP_BUFFER,
    });
    return {
      path: entry.replace(/\\/g, '/'),
      content,
      sizeBytes: Buffer.byteLength(content, 'utf-8'),
    };
  });
}

main();
