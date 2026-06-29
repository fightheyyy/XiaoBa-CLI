import { Command } from 'commander';
import { ArenaManager } from '../arena/arena-manager';
import {
  ArenaAllowedRuntime,
  ArenaDecision,
  ArenaNetworkMode,
  ArenaReviewMode,
  ArenaSandboxEngine,
  ArenaSandboxMode,
  ArenaTrustLevel,
  PrepareArenaRuntimeInput,
} from '../arena/types';

export function registerArenaCommand(program: Command): void {
  const arenaCmd = program
    .command('arena')
    .description('Arena: trace-grounded agentic eval for XiaoBa skills and roles');

  const importCmd = arenaCmd
    .command('import')
    .description('Import arena-only subjects without promoting them to production');

  importCmd
    .command('skill <path>')
    .description('Import a local skill into arena/subjects')
    .option('--trust <level>', 'trust level: untrusted|review_required|reviewed|promoted')
    .option('--allowed-runtime <level>', 'allowed runtime: arena_only|production_candidate|production')
    .action((skillPath: string, options: ImportSubjectOptions) => {
      const manifest = new ArenaManager().importLocalSkill({
        skillPath,
        trustLevel: parseTrustLevel(options.trust),
        allowedRuntime: parseAllowedRuntime(options.allowedRuntime),
      });
      printJson(manifest);
    });

  importCmd
    .command('github <repo>')
    .description('Clone, pin and scan a GitHub skill into arena/subjects')
    .option('--ref <ref>', 'git ref to checkout before pinning commit')
    .option('--trust <level>', 'trust level: untrusted|review_required|reviewed|promoted')
    .option('--allowed-runtime <level>', 'allowed runtime: arena_only|production_candidate|production')
    .action((repo: string, options: ImportGithubOptions) => {
      const manifest = new ArenaManager().importGithubSkill({
        repo,
        ref: options.ref,
        trustLevel: parseTrustLevel(options.trust) || 'untrusted',
        allowedRuntime: parseAllowedRuntime(options.allowedRuntime),
      });
      printJson(manifest);
    });

  const snapshotCmd = arenaCmd
    .command('snapshot')
    .description('Snapshot local subjects for Arena review');

  snapshotCmd
    .command('role <role-id>')
    .description('Snapshot a local role into arena/subjects')
    .option('--trust <level>', 'trust level: untrusted|review_required|reviewed|promoted')
    .option('--allowed-runtime <level>', 'allowed runtime: arena_only|production_candidate|production')
    .action((roleId: string, options: ImportSubjectOptions) => {
      const manifest = new ArenaManager().snapshotRole({
        roleId,
        trustLevel: parseTrustLevel(options.trust),
        allowedRuntime: parseAllowedRuntime(options.allowedRuntime),
      });
      printJson(manifest);
    });

  const runCmd = arenaCmd
    .command('run')
    .description('Create and validate Arena run indexes');

  runCmd
    .command('create')
    .description('Create arena/runs/<run-id>/arena-run.json from real evidence refs')
    .requiredOption('--mode <mode>', 'base_skill|role_skill|role')
    .requiredOption('--subject <id>', 'Arena subject id or path to arena-manifest.json')
    .option('--run-id <id>', 'run id')
    .option('--target-role <id>', 'required for role_skill and role modes')
    .option('--surface <name>', 'surface used by UserCat, default pet')
    .requiredOption('--usercat-run <id>', 'UserCat run id')
    .requiredOption('--usercat-package <path>', 'UserCat run package path')
    .option('--usercat-trace <path>', 'UserCat trace ref; repeatable', collectOption, [])
    .option('--trace <path>', 'native runtime trace ref; repeatable', collectOption, [])
    .option('--inspector <path>', 'Inspector candidate case / issue ref; repeatable', collectOption, [])
    .requiredOption('--reviewer-run <id>', 'ReviewerCat run id')
    .requiredOption('--scorecard <path>', 'Reviewer scorecard path')
    .requiredOption('--report <path>', 'Reviewer report path')
    .requiredOption('--decision <decision>', 'pass|unstable|reopened|blocked|unsafe')
    .option('--attempts-planned <n>', 'planned replay attempts')
    .option('--attempts-completed <n>', 'completed replay attempts')
    .option('--attempts-pass <n>', 'passing replay attempts')
    .option('--attempts-fail <n>', 'failing replay attempts')
    .option('--attempts-blocked <n>', 'blocked replay attempts')
    .option('--replay-trace <path>', 'fresh replay trace ref; repeatable', collectOption, [])
    .option('--sandbox-engine <engine>', 'macos_seatbelt|linux_bubblewrap|windows_native|local_spawn|none')
    .option('--sandbox-mode <mode>', 'metadata_only|read_only|workspace_write')
    .option('--sandbox-workspace <path>', 'sandbox workspace root')
    .option('--sandbox-subject-root <path>', 'sandbox subject root')
    .option('--sandbox-writable <path>', 'sandbox writable root; repeatable', collectOption, [])
    .option('--network <mode>', 'disabled|enabled')
    .option('--timeout-ms <n>', 'sandbox command timeout')
    .option('--summary <text>', 'scorecard summary')
    .action((options: ArenaRunCreateOptions) => {
      const traceRefs = nonEmptyList(options.trace, '--trace');
      const manager = new ArenaManager();
      const runIndex = manager.createRunIndex({
        runId: options.runId,
        reviewMode: parseReviewMode(options.mode),
        subjectId: options.subject,
        targetRoleId: options.targetRole,
        surface: options.surface,
        usercatRunRef: {
          run_id: options.usercatRun,
          package_path: options.usercatPackage,
          trace_refs: options.usercatTrace?.length ? options.usercatTrace : traceRefs,
        },
        traceRefs,
        inspectorRefs: options.inspector || [],
        reviewerRef: {
          run_id: options.reviewerRun,
          scorecard_path: options.scorecard,
          report_path: options.report,
        },
        replayAttempts: {
          planned: parseOptionalNonNegativeInt(options.attemptsPlanned, '--attempts-planned'),
          completed: parseOptionalNonNegativeInt(options.attemptsCompleted, '--attempts-completed'),
          pass_count: parseOptionalNonNegativeInt(options.attemptsPass, '--attempts-pass'),
          fail_count: parseOptionalNonNegativeInt(options.attemptsFail, '--attempts-fail'),
          blocked_count: parseOptionalNonNegativeInt(options.attemptsBlocked, '--attempts-blocked'),
          trace_refs: options.replayTrace || [],
        },
        sandbox: parseSandboxOptions(options),
        decision: parseDecision(options.decision),
        scorecardSummary: options.summary,
      });
      printJson(runIndex);
    });

  const runtimeCmd = arenaCmd
    .command('runtime')
    .description('Prepare clean Arena runtime overlays');

  runtimeCmd
    .command('prepare')
    .description('Prepare a clean base or role runtime for evaluating a skill or role')
    .requiredOption('--mode <mode>', 'base_skill|role_skill|role')
    .requiredOption('--subject <id>', 'Arena subject id or path to arena-manifest.json')
    .option('--run-id <id>', 'run id')
    .option('--target-role <id>', 'required for role_skill and role modes')
    .option('--surface <name>', 'surface used by UserCat, default pet')
    .option('--pass-env <name>', 'environment variable name to pass through; repeatable', collectOption, [])
    .option('--sandbox-engine <engine>', 'macos_seatbelt|linux_bubblewrap|windows_native|local_spawn|none')
    .option('--sandbox-mode <mode>', 'metadata_only|read_only|workspace_write')
    .option('--sandbox-workspace <path>', 'sandbox workspace root')
    .option('--sandbox-subject-root <path>', 'sandbox subject root')
    .option('--sandbox-writable <path>', 'sandbox writable root; repeatable', collectOption, [])
    .option('--network <mode>', 'disabled|enabled')
    .option('--timeout-ms <n>', 'sandbox command timeout')
    .action((options: ArenaRuntimePrepareOptions) => {
      const manager = new ArenaManager();
      const runtimeIndex = manager.prepareCleanRuntime({
        runId: options.runId,
        reviewMode: parseReviewMode(options.mode),
        subjectId: options.subject,
        targetRoleId: options.targetRole,
        surface: options.surface,
        passThroughEnv: options.passEnv || [],
        sandbox: parseSandboxOptions(options),
      });
      printJson(runtimeIndex);
    });
}

interface ImportSubjectOptions {
  trust?: string;
  allowedRuntime?: string;
}

interface ImportGithubOptions extends ImportSubjectOptions {
  ref?: string;
}

interface ArenaSandboxOptionSet {
  sandboxEngine?: string;
  sandboxMode?: string;
  sandboxWorkspace?: string;
  sandboxSubjectRoot?: string;
  sandboxWritable?: string[];
  network?: string;
  timeoutMs?: string;
}

interface ArenaRunCreateOptions extends ArenaSandboxOptionSet {
  mode: string;
  subject: string;
  runId?: string;
  targetRole?: string;
  surface?: string;
  usercatRun: string;
  usercatPackage: string;
  usercatTrace?: string[];
  trace?: string[];
  inspector?: string[];
  reviewerRun: string;
  scorecard: string;
  report: string;
  decision: string;
  attemptsPlanned?: string;
  attemptsCompleted?: string;
  attemptsPass?: string;
  attemptsFail?: string;
  attemptsBlocked?: string;
  replayTrace?: string[];
  summary?: string;
}

interface ArenaRuntimePrepareOptions extends ArenaSandboxOptionSet {
  mode: string;
  subject: string;
  runId?: string;
  targetRole?: string;
  surface?: string;
  passEnv?: string[];
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function parseTrustLevel(value: string | undefined): ArenaTrustLevel | undefined {
  if (!value) return undefined;
  const allowed: ArenaTrustLevel[] = ['untrusted', 'review_required', 'reviewed', 'promoted'];
  if (allowed.includes(value as ArenaTrustLevel)) return value as ArenaTrustLevel;
  throw new Error(`invalid trust level: ${value}`);
}

function parseAllowedRuntime(value: string | undefined): ArenaAllowedRuntime | undefined {
  if (!value) return undefined;
  const allowed: ArenaAllowedRuntime[] = ['arena_only', 'production_candidate', 'production'];
  if (allowed.includes(value as ArenaAllowedRuntime)) return value as ArenaAllowedRuntime;
  throw new Error(`invalid allowed runtime: ${value}`);
}

function parseReviewMode(value: string): ArenaReviewMode {
  const allowed: ArenaReviewMode[] = ['base_skill', 'role_skill', 'role'];
  if (allowed.includes(value as ArenaReviewMode)) return value as ArenaReviewMode;
  throw new Error(`invalid review mode: ${value}`);
}

function parseDecision(value: string): ArenaDecision {
  const allowed: ArenaDecision[] = ['pass', 'unstable', 'reopened', 'blocked', 'unsafe'];
  if (allowed.includes(value as ArenaDecision)) return value as ArenaDecision;
  throw new Error(`invalid decision: ${value}`);
}

function parseSandboxOptions(options: ArenaSandboxOptionSet): PrepareArenaRuntimeInput['sandbox'] {
  const sandbox: PrepareArenaRuntimeInput['sandbox'] = {};
  if (options.sandboxEngine) sandbox.engine = parseSandboxEngine(options.sandboxEngine);
  if (options.sandboxMode) sandbox.mode = parseSandboxMode(options.sandboxMode);
  if (options.sandboxWorkspace) sandbox.workspace_root = options.sandboxWorkspace;
  if (options.sandboxSubjectRoot) sandbox.subject_root = options.sandboxSubjectRoot;
  if (options.sandboxWritable?.length) sandbox.writable_roots = options.sandboxWritable;
  if (options.network) sandbox.network = parseNetworkMode(options.network);
  const timeoutMs = parseOptionalNonNegativeInt(options.timeoutMs, '--timeout-ms');
  if (timeoutMs !== undefined) sandbox.timeout_ms = timeoutMs;
  return sandbox;
}

function parseSandboxEngine(value: string): ArenaSandboxEngine {
  const allowed: ArenaSandboxEngine[] = ['macos_seatbelt', 'linux_bubblewrap', 'windows_native', 'local_spawn', 'none'];
  if (allowed.includes(value as ArenaSandboxEngine)) return value as ArenaSandboxEngine;
  throw new Error(`invalid sandbox engine: ${value}`);
}

function parseSandboxMode(value: string): ArenaSandboxMode {
  const allowed: ArenaSandboxMode[] = ['metadata_only', 'read_only', 'workspace_write'];
  if (allowed.includes(value as ArenaSandboxMode)) return value as ArenaSandboxMode;
  throw new Error(`invalid sandbox mode: ${value}`);
}

function parseNetworkMode(value: string): ArenaNetworkMode {
  const allowed: ArenaNetworkMode[] = ['disabled', 'enabled'];
  if (allowed.includes(value as ArenaNetworkMode)) return value as ArenaNetworkMode;
  throw new Error(`invalid network mode: ${value}`);
}

function parseOptionalNonNegativeInt(value: string | undefined, name: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function nonEmptyList(values: string[] | undefined, name: string): string[] {
  const normalized = (values || []).map(value => value.trim()).filter(Boolean);
  if (normalized.length === 0) {
    throw new Error(`${name} is required at least once`);
  }
  return normalized;
}
