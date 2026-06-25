import * as fs from 'fs';
import * as path from 'path';

export type EngineerValidationSource = 'explicit' | 'inferred' | 'not_configured';

export interface EngineerValidationPlan {
  source: EngineerValidationSource;
  commands: string[];
  reasons: string[];
}

export interface EngineerValidationPlanInput {
  cwd: string;
  request: string;
  explicitCommands?: unknown;
  allowEdits: boolean;
}

export interface EngineerChangedFileValidationPlanInput {
  cwd: string;
  changedFiles: string[];
  existingCommands?: string[];
}

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
}

const DEFAULT_MAX_INFERRED_COMMANDS = 2;
const XIAOBA_PACKAGE_NAME = 'xiaoba-cli';

export function planEngineerValidation(input: EngineerValidationPlanInput): EngineerValidationPlan {
  const explicit = normalizeValidationCommands(input.explicitCommands);
  if (explicit.length > 0) {
    return {
      source: 'explicit',
      commands: explicit,
      reasons: ['Caller provided explicit validation_commands.'],
    };
  }

  if (process.env.XIAOBA_ENGINEER_DISABLE_INFERRED_VALIDATION === '1') {
    return {
      source: 'not_configured',
      commands: [],
      reasons: ['XIAOBA_ENGINEER_DISABLE_INFERRED_VALIDATION=1 disables inferred quality gates.'],
    };
  }

  if (!input.allowEdits) {
    return {
      source: 'not_configured',
      commands: [],
      reasons: ['Task is read-only; inferred quality gates are skipped unless validation_commands are explicit.'],
    };
  }

  const packageJson = readPackageJson(input.cwd);
  if (!packageJson?.scripts) {
    return {
      source: 'not_configured',
      commands: [],
      reasons: ['No package.json scripts were found for automatic validation inference.'],
    };
  }

  const manager = detectPackageManager(input.cwd);
  const commands: string[] = [];
  const reasons: string[] = [];
  const addScript = (script: string, reason: string) => {
    if (!packageJson.scripts?.[script] || commands.length >= readMaxInferredCommands()) {
      return;
    }
    commands.push(`${manager} run ${script}`);
    reasons.push(reason);
  };

  addScript('build', 'package.json defines a build script, so build is the default engineering gate.');

  if (shouldRunTaskFocusedTests(input.request, packageJson)) {
    addScript('test', 'Request looks implementation- or regression-related and package.json defines a test script.');
  } else if (commands.length === 0) {
    addScript('typecheck', 'No build gate was available; typecheck is the next deterministic Node/TypeScript gate.');
    addScript('test', 'No build/typecheck gate was available; test is the remaining deterministic project gate.');
  }

  return {
    source: commands.length > 0 ? 'inferred' : 'not_configured',
    commands,
    reasons: commands.length > 0 ? reasons : ['No suitable automatic validation scripts were found.'],
  };
}

export function normalizeValidationCommands(commands: unknown): string[] {
  if (!Array.isArray(commands)) {
    return [];
  }
  const result: string[] = [];
  for (const command of commands) {
    const text = String(command || '').trim();
    if (text) {
      result.push(text);
    }
  }
  return result;
}

export function planChangedFileValidation(input: EngineerChangedFileValidationPlanInput): EngineerValidationPlan {
  const changedFiles = input.changedFiles.map(normalizePath).filter(Boolean);
  if (changedFiles.length === 0) {
    return {
      source: 'not_configured',
      commands: [],
      reasons: ['No changed files were detected for changed-file-aware validation.'],
    };
  }

  const packageJson = readPackageJson(input.cwd);
  if (packageJson?.name !== XIAOBA_PACKAGE_NAME) {
    return {
      source: 'not_configured',
      commands: [],
      reasons: ['Changed-file-aware XiaoBa gates apply only when package.json name is xiaoba-cli.'],
    };
  }

  const existing = new Set(normalizeValidationCommands(input.existingCommands));
  const commands: string[] = [];
  const reasons: string[] = [];
  const addCommand = (command: string, reason: string, requiredFiles: string[]) => {
    if (existing.has(command) || commands.includes(command)) {
      return;
    }
    if (requiredFiles.some(file => !fs.existsSync(path.join(input.cwd, file)))) {
      return;
    }
    commands.push(command);
    reasons.push(reason);
  };

  if (changedFiles.some(file => file.startsWith('roles/engineer-cat/') || file.startsWith('src/roles/engineer-cat/'))) {
    addCommand(
      'node --test -r tsx test/engineer-task-runner.test.ts test/engineer-codex-supervisor.test.ts test/engineer-cat-codex-runner.test.ts test/tool-manager-roles.test.ts',
      'EngineerCat role/runtime files changed, so the role contract, task runner, and role-tool visibility tests are required.',
      [
        'test/engineer-task-runner.test.ts',
        'test/engineer-codex-supervisor.test.ts',
        'test/engineer-cat-codex-runner.test.ts',
        'test/tool-manager-roles.test.ts',
      ],
    );
  }

  if (changedFiles.some(file => file.startsWith('eval/') || file.startsWith('eval/benchmarks/'))) {
    addCommand(
      'node --test -r tsx test/eval-benchmark-bridge.test.ts test/eval-gate.test.ts && npm run check:benchmarks',
      'Eval or benchmark files changed, so benchmark bridge, aggregate gate tests, and lightweight benchmark manifest checks are required.',
      [
        'test/eval-benchmark-bridge.test.ts',
        'test/eval-gate.test.ts',
        'scripts/check-benchmarks.ts',
      ],
    );
  }

  if (changedFiles.some(file => file.startsWith('src/commands/'))) {
    addCommand(
      'node --test -r tsx test/cli-chat-command-options.test.ts',
      'CLI command files changed, so chat command option tests are required.',
      ['test/cli-chat-command-options.test.ts'],
    );
  }

  if (changedFiles.some(file => file.startsWith('src/core/') || file.startsWith('src/tools/'))) {
    addCommand(
      'node --test -r tsx test/conversation-runner-harness.test.ts test/agent-session-log.test.ts test/tool-manager-roles.test.ts',
      'Core runtime or tool files changed, so runner/session/tool contract tests are required.',
      [
        'test/conversation-runner-harness.test.ts',
        'test/agent-session-log.test.ts',
        'test/tool-manager-roles.test.ts',
      ],
    );
  }

  return {
    source: commands.length > 0 ? 'inferred' : 'not_configured',
    commands,
    reasons: commands.length > 0 ? reasons : ['No changed-file-aware XiaoBa gate matched the changed files.'],
  };
}

function readPackageJson(cwd: string): PackageJson | undefined {
  const packagePath = path.join(cwd, 'package.json');
  try {
    return JSON.parse(fs.readFileSync(packagePath, 'utf-8')) as PackageJson;
  } catch {
    return undefined;
  }
}

function normalizePath(file: string): string {
  return String(file || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function detectPackageManager(cwd: string): 'npm' | 'pnpm' | 'yarn' {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) {
    return 'yarn';
  }
  return 'npm';
}

function shouldRunTaskFocusedTests(request: string, packageJson: PackageJson): boolean {
  if (!packageJson.scripts?.test) {
    return false;
  }
  const text = `${packageJson.name || ''}\n${request}`.toLowerCase();
  return [
    'xiaoba-cli',
    'engineer',
    'feishu',
    'codex',
    'reviewer',
    '测试',
    '验证',
    '回归',
    '修复',
    '实现',
    '维护',
    'bug',
    'fix',
    'regression',
    'test',
  ].some(keyword => text.includes(keyword));
}

function readMaxInferredCommands(): number {
  const value = Number(process.env.XIAOBA_ENGINEER_MAX_INFERRED_VALIDATION_COMMANDS);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_INFERRED_COMMANDS;
}
