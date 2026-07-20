import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { TraceReplayReport } from '../../replay/trace-replay-runner';
import { renderTraceReplayReport } from '../../replay/trace-replay-runner';

const PATCH_EXCLUDES = [
  'output',
  'logs',
  'data',
  'memory',
  'arena',
  'node_modules',
  'files',
  'turnLogs',
];

const PROTECTED_EVALUATOR_PATHS = [
  'src/arena/',
  'src/replay/',
  'src/roles/reviewer-cat/tools/trace-replay-tool.ts',
  'src/roles/evolution-cat/evolution-patch-workspace.ts',
  'src/arena/patch-regression.ts',
  'scripts/run-trace-replay.ts',
];

export interface EvolutionPatchWorkspace {
  projectRoot: string;
  runRoot: string;
  workspaceRoot: string;
  workspaceRunRoot: string;
  candidateRoot: string;
  baseCommit: string;
  tempRoot: string;
  dependencyLinkCreated: boolean;
}

export interface EvolutionPatchEvidenceSnapshot {
  source_ref: string;
  snapshot_ref: string;
  sha256: string;
  kind: 'file' | 'directory';
}

export interface EvolutionPatchCandidateManifest {
  version: 1;
  type: 'patch';
  candidate_id: string;
  base_commit: string;
  patch_ref: string;
  patch_sha256: string;
  changed_files: string[];
  source_checkout_dirty: boolean;
  artifact_evidence: EvolutionPatchEvidenceSnapshot[];
  verification_evidence: EvolutionPatchEvidenceSnapshot[];
  created_at: string;
}

export function createEvolutionPatchWorkspace(input: {
  projectRoot: string;
  runRoot: string;
  targetDate: string;
  evidenceRefs: string[];
}): EvolutionPatchWorkspace {
  const projectRoot = realDirectory(input.projectRoot, 'Project root');
  const runRoot = realDirectory(input.runRoot, 'Evolution run root');
  ensureInside(projectRoot, runRoot, 'Evolution run root');
  const gitRoot = git(projectRoot, ['rev-parse', '--show-toplevel']).trim();
  if (fs.realpathSync(gitRoot) !== projectRoot) {
    throw new Error('Evolution repair requires the project root to be the Git worktree root');
  }
  const baseCommit = git(projectRoot, ['rev-parse', 'HEAD']).trim();
  if (!/^[0-9a-f]{40}$/i.test(baseCommit)) {
    throw new Error('Evolution repair requires a concrete Git HEAD commit');
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-evolution-patch-'));
  const workspaceRoot = path.join(tempRoot, 'worktree');
  try {
    git(projectRoot, ['worktree', 'add', '--detach', workspaceRoot, baseCommit]);
    const workspaceRunRoot = path.join(
      workspaceRoot,
      path.relative(projectRoot, runRoot),
    );
    ensureInside(workspaceRoot, workspaceRunRoot, 'Patch workspace run root');
    fs.mkdirSync(workspaceRunRoot, { recursive: true });

    for (const name of ['digest.json', 'inspector-route.json', 'next-run-seed.json']) {
      const source = path.join(runRoot, name);
      if (fs.existsSync(source)) {
        copyRegularPath(source, path.join(workspaceRunRoot, name));
      }
    }
    for (const ref of input.evidenceRefs) {
      const filePart = ref.split('#', 1)[0]?.trim();
      if (!filePart) throw new Error(`Patch workspace received an invalid evidence ref: ${ref}`);
      const source = resolveExistingInside(projectRoot, path.resolve(projectRoot, filePart), 'Patch source evidence');
      const relative = path.relative(projectRoot, source);
      copyRegularPath(source, path.join(workspaceRoot, relative));
    }

    let dependencyLinkCreated = false;
    const projectNodeModules = path.join(projectRoot, 'node_modules');
    const workspaceNodeModules = path.join(workspaceRoot, 'node_modules');
    if (fs.existsSync(projectNodeModules) && !fs.existsSync(workspaceNodeModules)) {
      fs.symlinkSync(projectNodeModules, workspaceNodeModules, 'dir');
      dependencyLinkCreated = true;
    }

    return {
      projectRoot,
      runRoot,
      workspaceRoot,
      workspaceRunRoot,
      candidateRoot: path.join(runRoot, 'patch-candidate'),
      baseCommit,
      tempRoot,
      dependencyLinkCreated,
    };
  } catch (error) {
    tryRemoveWorktree(projectRoot, workspaceRoot);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    pruneWorktrees(projectRoot);
    throw error;
  }
}

export function finalizeEvolutionPatchCandidate(input: {
  workspace: EvolutionPatchWorkspace;
  artifactRefs: string[];
  verificationRefs: string[];
  now: Date;
}): EvolutionPatchCandidateManifest {
  const workspace = input.workspace;
  git(workspace.workspaceRoot, ['add', '-A', '--', '.']);
  const changedFiles = gitBuffer(workspace.workspaceRoot, [
    'diff', '--cached', '--name-only', '-z', '--diff-filter=ACDMRTUXB', workspace.baseCommit, '--', '.',
  ]).toString('utf-8').split('\0').map(item => item.trim()).filter(Boolean).sort();
  if (changedFiles.length === 0) {
    throw new Error('EngineerCat reported fixed but the isolated worktree contains no code patch');
  }
  const excludedPath = changedFiles.find(isExcludedPatchPath);
  if (excludedPath) {
    throw new Error(`Patch Candidate contains runtime/output state instead of source: ${excludedPath}`);
  }
  const protectedPath = changedFiles.find(isProtectedEvaluatorPath);
  if (protectedPath) {
    throw new Error(`Patch Candidate changes its own replay/evaluation trust root: ${protectedPath}`);
  }

  const patch = gitBuffer(workspace.workspaceRoot, [
    'diff', '--cached', '--binary', '--full-index', workspace.baseCommit, '--', '.',
  ]);
  if (patch.length === 0) {
    throw new Error('Patch Candidate diff is empty');
  }

  resetOwnedDirectory(workspace.runRoot, workspace.candidateRoot, 'Patch Candidate root');
  const patchPath = path.join(workspace.candidateRoot, 'candidate.patch');
  fs.writeFileSync(patchPath, patch);
  const patchSha256 = sha256Buffer(patch);
  const artifactEvidence = snapshotEvidence(
    workspace,
    input.artifactRefs,
    path.join(workspace.candidateRoot, 'evidence', 'artifacts'),
  );
  const verificationEvidence = snapshotEvidence(
    workspace,
    input.verificationRefs,
    path.join(workspace.candidateRoot, 'evidence', 'verification'),
  );
  const manifest: EvolutionPatchCandidateManifest = {
    version: 1,
    type: 'patch',
    candidate_id: `patch-${patchSha256.slice(0, 16)}`,
    base_commit: workspace.baseCommit,
    patch_ref: relativeRef(patchPath, workspace.projectRoot),
    patch_sha256: patchSha256,
    changed_files: changedFiles,
    source_checkout_dirty: git(workspace.projectRoot, ['status', '--porcelain']).trim().length > 0,
    artifact_evidence: artifactEvidence,
    verification_evidence: verificationEvidence,
    created_at: input.now.toISOString(),
  };
  writeJson(path.join(workspace.candidateRoot, 'manifest.json'), manifest);
  mirrorMainRunArtifact(workspace, 'patch-candidate');
  return manifest;
}

export function mirrorMainRunArtifact(workspace: EvolutionPatchWorkspace, name: string): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error(`Unsafe DAG artifact name: ${name}`);
  const source = path.join(workspace.runRoot, name);
  if (!fs.existsSync(source)) throw new Error(`DAG artifact does not exist: ${name}`);
  const destination = path.join(workspace.workspaceRunRoot, name);
  if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
  copyRegularPath(source, destination);
}

export function snapshotEvolutionWorkspaceRefs(input: {
  workspace: EvolutionPatchWorkspace;
  refs: string[];
  group: string;
}): EvolutionPatchEvidenceSnapshot[] {
  if (!/^[a-zA-Z0-9._-]+$/.test(input.group)) throw new Error(`Unsafe evidence group: ${input.group}`);
  return snapshotEvidence(
    input.workspace,
    input.refs,
    path.join(input.workspace.candidateRoot, 'evidence', input.group),
  );
}

export function relocateReplayArtifacts(input: {
  workspace: EvolutionPatchWorkspace;
  sourceDirectory: string;
  destinationDirectory: string;
}): TraceReplayReport {
  const sourceDirectory = resolveExistingInside(
    input.workspace.workspaceRoot,
    input.sourceDirectory,
    'Patch replay source directory',
  );
  resetOwnedDirectory(input.workspace.runRoot, input.destinationDirectory, 'Durable replay output');
  copyRegularPath(sourceDirectory, input.destinationDirectory);
  const manifestPath = path.join(input.destinationDirectory, 'manifest.json');
  const report = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as TraceReplayReport;

  const sourceTrace = path.join(input.destinationDirectory, 'source-trace.jsonl');
  if (fs.existsSync(sourceTrace)) report.input_trace_path = sourceTrace;
  if (report.fresh_trace_path && fs.existsSync(report.fresh_trace_path)) {
    const durableFreshTrace = path.join(input.destinationDirectory, 'fresh-trace.jsonl');
    copyRegularPath(report.fresh_trace_path, durableFreshTrace);
    report.fresh_trace_path = durableFreshTrace;
  }
  if (report.visible_history_path && fs.existsSync(report.visible_history_path)) {
    const durableVisibleHistory = path.join(input.destinationDirectory, 'visible-history.json');
    copyRegularPath(report.visible_history_path, durableVisibleHistory);
    report.visible_history_path = durableVisibleHistory;
  }
  report.out_dir = input.destinationDirectory;
  report.artifacts = {
    manifest_path: manifestPath,
    extracted_inputs_path: path.join(input.destinationDirectory, 'extracted-inputs.json'),
    replay_results_path: path.join(input.destinationDirectory, 'replay-results.json'),
    comparison_path: path.join(input.destinationDirectory, 'comparison.json'),
    report_path: path.join(input.destinationDirectory, 'report.md'),
  };
  writeJson(manifestPath, report);
  fs.writeFileSync(report.artifacts.report_path, renderTraceReplayReport(report), 'utf-8');
  return report;
}

export function cleanupEvolutionPatchWorkspace(workspace: EvolutionPatchWorkspace): void {
  tryRemoveWorktree(workspace.projectRoot, workspace.workspaceRoot);
  fs.rmSync(workspace.tempRoot, { recursive: true, force: true });
  pruneWorktrees(workspace.projectRoot);
}

function snapshotEvidence(
  workspace: EvolutionPatchWorkspace,
  refs: string[],
  destinationRoot: string,
): EvolutionPatchEvidenceSnapshot[] {
  return refs.map((ref, index) => {
    const filePart = ref.split('#', 1)[0]?.trim();
    if (!filePart) throw new Error(`Engineer evidence contains an invalid ref: ${ref}`);
    const source = resolveExistingInside(
      workspace.workspaceRoot,
      path.resolve(workspace.workspaceRoot, filePart),
      'Engineer evidence',
    );
    const safeName = `${String(index + 1).padStart(2, '0')}-${path.basename(source).replace(/[^a-zA-Z0-9._-]+/g, '-')}`;
    const destination = path.join(destinationRoot, safeName);
    copyRegularPath(source, destination);
    return {
      source_ref: ref,
      snapshot_ref: relativeRef(destination, workspace.projectRoot),
      sha256: fingerprintPath(destination),
      kind: fs.statSync(destination).isDirectory() ? 'directory' : 'file',
    };
  });
}

function isProtectedEvaluatorPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return PROTECTED_EVALUATOR_PATHS.some(item => normalized === item || normalized.startsWith(item));
}

function isExcludedPatchPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return PATCH_EXCLUDES.some(item => normalized === item || normalized.startsWith(`${item}/`));
}

function copyRegularPath(source: string, destination: string): void {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`Refusing to snapshot symlink: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (stat.isDirectory()) {
    fs.cpSync(source, destination, {
      recursive: true,
      dereference: false,
      filter: child => {
        if (fs.lstatSync(child).isSymbolicLink()) {
          throw new Error(`Snapshot contains a symlink: ${child}`);
        }
        return true;
      },
    });
    assertNoSymlinks(destination);
    return;
  }
  if (!stat.isFile()) throw new Error(`Evidence is not a regular file or directory: ${source}`);
  fs.copyFileSync(source, destination);
}

function assertNoSymlinks(root: string): void {
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink()) throw new Error(`Snapshot contains a symlink: ${root}`);
  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(root)) assertNoSymlinks(path.join(root, entry));
}

function fingerprintPath(target: string): string {
  const stat = fs.statSync(target);
  if (stat.isFile()) return sha256Buffer(fs.readFileSync(target));
  const hash = crypto.createHash('sha256');
  for (const file of walkFiles(target)) {
    hash.update(path.relative(target, file).replace(/\\/g, '/'));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Snapshot contains a symlink: ${child}`);
    if (entry.isDirectory()) files.push(...walkFiles(child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

function git(cwd: string, args: string[]): string {
  return gitBuffer(cwd, args).toString('utf-8');
}

function gitBuffer(cwd: string, args: string[]): Buffer {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error: any) {
    const stderr = Buffer.isBuffer(error?.stderr) ? error.stderr.toString('utf-8').trim() : '';
    throw new Error(`Git patch workspace failed: ${stderr || String(error?.message || error)}`);
  }
}

function tryRemoveWorktree(projectRoot: string, workspaceRoot: string): void {
  try {
    execFileSync('git', ['-C', projectRoot, 'worktree', 'remove', '--force', workspaceRoot], {
      stdio: 'ignore',
    });
  } catch {
    // The temp root is removed by the owner before a final prune.
  }
}

function pruneWorktrees(projectRoot: string): void {
  try {
    execFileSync('git', ['-C', projectRoot, 'worktree', 'prune'], { stdio: 'ignore' });
  } catch {
    // Cleanup must not replace the primary DAG result.
  }
}

function realDirectory(target: string, label: string): string {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`${label} is not a directory: ${resolved}`);
  }
  return fs.realpathSync(resolved);
}

function resolveExistingInside(root: string, target: string, label: string): string {
  const resolved = path.resolve(target);
  ensureInside(root, resolved, label);
  if (!fs.existsSync(resolved)) throw new Error(`${label} does not exist: ${resolved}`);
  const real = fs.realpathSync(resolved);
  ensureInside(fs.realpathSync(root), real, label);
  return real;
}

function resetOwnedDirectory(root: string, directory: string, label: string): void {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(directory);
  ensureInside(resolvedRoot, resolved, label);
  if (resolved === resolvedRoot) throw new Error(`${label} cannot replace its owner root`);
  if (fs.existsSync(resolved)) fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
}

function ensureInside(root: string, target: string, label: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative === '.' || relative.startsWith('..') || path.isAbsolute(relative)) {
    if (path.resolve(root) === path.resolve(target)) return;
    throw new Error(`${label} escapes its owner root`);
  }
}

function relativeRef(target: string, root: string): string {
  return path.relative(root, target).replace(/\\/g, '/');
}

function sha256Buffer(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}
