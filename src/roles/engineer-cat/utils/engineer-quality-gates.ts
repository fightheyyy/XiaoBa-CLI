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

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
}

const DEFAULT_MAX_INFERRED_COMMANDS = 2;

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

function readPackageJson(cwd: string): PackageJson | undefined {
  const packagePath = path.join(cwd, 'package.json');
  try {
    return JSON.parse(fs.readFileSync(packagePath, 'utf-8')) as PackageJson;
  } catch {
    return undefined;
  }
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
    'autodev',
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
