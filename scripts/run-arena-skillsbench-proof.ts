#!/usr/bin/env tsx
import * as fs from 'fs';
import * as path from 'path';
import { ArenaManager } from '../src/arena/arena-manager';
import { executeArenaRun } from '../src/arena/arena-runner';
import { writeSkillsBenchLiveProofScorecards } from '../src/arena/skillsbench-live-proof';
import { PathResolver } from '../src/utils/path-resolver';

interface Options {
  caseId: string;
  runId?: string;
  scenarioCount?: number;
  maxTurns?: number;
  replayAttempts?: number;
  maxReplayCases?: number;
  skipExecute?: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = PathResolver.getProjectRoot();
  const caseRoot = path.join(projectRoot, 'arena', 'benchmarks', 'cat-effectiveness', 'cases', options.caseId);
  const taskPath = path.join(caseRoot, 'task.md');
  const workspaceSeedPath = path.join(caseRoot, 'workspace');
  const subjectSkillPath = firstSubjectSkillPath(path.join(caseRoot, 'subject-skills'));
  if (!fs.existsSync(taskPath) || !fs.existsSync(workspaceSeedPath) || !fs.existsSync(subjectSkillPath)) {
    throw new Error(`Materialized SkillsBench case is incomplete: ${caseRoot}`);
  }

  const runId = options.runId || `${options.caseId.replace(/[^a-zA-Z0-9._-]+/g, '-')}-${timestamp()}`;
  if (!options.skipExecute) {
    const manager = new ArenaManager({ projectRoot });
    const manifest = manager.importLocalSkill({ skillPath: subjectSkillPath });
    const task = fs.readFileSync(taskPath, 'utf-8').trim();
    await executeArenaRun({
      projectRoot,
      runId,
      reviewMode: 'base_skill',
      subjectId: manifest.subject_id,
      workspaceSeedPath,
      scenario: task,
      messages: userCatMessagesForCase(options.caseId, task, caseRoot),
      scenarioCount: options.scenarioCount || 1,
      maxTurns: options.maxTurns || 4,
      replayAttempts: options.replayAttempts || 3,
      maxReplayCases: options.maxReplayCases || 2,
      sandbox: {
        timeout_ms: 900_000,
      },
    });
  }

  const result = writeSkillsBenchLiveProofScorecards({
    projectRoot,
    runId,
    caseId: options.caseId,
  });
  console.log(JSON.stringify(result, null, 2));
}

function userCatMessagesForCase(caseId: string, task: string, caseRoot: string): string[] {
  if (caseId === 'skillsbench.offer-letter-generator.v1') {
    return [
      task,
      '你给我的文件必须叫 offer_letter_filled.docx，对吧？路径在哪里，别给我别的文件名。',
      '你确认占位符都没了，relocation 条件段也处理对了吗？',
      '最后用普通用户能看懂的话告诉我：文件在哪，我怎么确认它就是最终版。',
    ];
  }
  if (caseId === 'skillsbench.citation-check.v1') {
    return [
      task,
      '你最后要给我 answer.json，对吧？里面必须有 fake_citations 这个列表，路径在哪里，我怎么知道它真的是 JSON？',
      '里面是不是必须有 fake_citations 这个列表？你确认格式没问题了吗？',
      '最后别讲太复杂，就告诉我文件在哪、怎么确认已经完成；如果卡住就说具体原因。',
    ];
  }
  const expectedArtifacts = expectedArtifactsForCase(caseRoot);
  const artifactText = expectedArtifacts.length > 0
    ? expectedArtifacts.join(', ')
    : '最终产物';
  return [
    task,
    `你最后要给我 ${artifactText} 对吧？文件路径在哪里，别只说完成。`,
    `你确认这个产物格式是对的吗？简单说一下你怎么确认的，别讲太复杂。`,
    '最后用普通用户能看懂的话告诉我：文件在哪、是否完成；如果卡住就说具体原因。',
  ];
}

function expectedArtifactsForCase(caseRoot: string): string[] {
  const manifestPath = path.join(caseRoot, 'case-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return [];
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    return Array.isArray(manifest.task?.expected_artifacts)
      ? manifest.task.expected_artifacts.map((item: unknown) => String(item || '').trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function firstSubjectSkillPath(skillsRoot: string): string {
  if (!fs.existsSync(skillsRoot)) {
    return path.join(skillsRoot, 'docx');
  }
  const dirs = fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(skillsRoot, entry.name))
    .filter(dir => fs.existsSync(path.join(dir, 'SKILL.md')))
    .sort();
  if (dirs.length === 0) {
    return path.join(skillsRoot, 'docx');
  }
  return dirs[0];
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    caseId: 'skillsbench.offer-letter-generator.v1',
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === '--case-id' || arg === '--case') {
      options.caseId = requireValue(arg, next);
      index += 1;
    } else if (arg === '--run-id') {
      options.runId = requireValue(arg, next);
      index += 1;
    } else if (arg === '--scenario-count') {
      options.scenarioCount = parsePositiveInt(arg, requireValue(arg, next));
      index += 1;
    } else if (arg === '--max-turns') {
      options.maxTurns = parsePositiveInt(arg, requireValue(arg, next));
      index += 1;
    } else if (arg === '--replay-attempts') {
      options.replayAttempts = parsePositiveInt(arg, requireValue(arg, next));
      index += 1;
    } else if (arg === '--max-replay-cases') {
      options.maxReplayCases = parsePositiveInt(arg, requireValue(arg, next));
      index += 1;
    } else if (arg === '--skip-execute') {
      options.skipExecute = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveInt(flag: string, value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function printHelp(): void {
  console.log([
    'Usage: tsx scripts/run-arena-skillsbench-proof.ts [options]',
    '',
    'Options:',
    '  --case-id <id>          SkillsBench-derived case id',
    '  --run-id <id>           Arena run id',
    '  --scenario-count <n>    UserCat scenario count, default 1 for this live proof',
    '  --max-turns <n>         Max UserCat turns per scenario, default 4',
    '  --replay-attempts <n>   Reviewer replay attempts per Inspector case, default 3',
    '  --max-replay-cases <n>  Max Inspector cases selected for Reviewer replay, default 2',
    '  --skip-execute          Re-score an existing arena/runs/<run-id> run',
  ].join('\n'));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
