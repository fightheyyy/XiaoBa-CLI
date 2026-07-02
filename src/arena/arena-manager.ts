import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { RoleManager } from '../roles/role-manager';
import { DEFAULT_BUNDLED_BASE_SKILLS } from '../skills/skill-manager';
import { SkillParser } from '../skills/skill-parser';
import { PathResolver } from '../utils/path-resolver';
import {
  ArenaAllowedRuntime,
  ArenaCleanRuntimeIndex,
  ArenaDecision,
  ArenaDefaultSandbox,
  ArenaReplayAttempts,
  ArenaReviewMode,
  ArenaRunIndex,
  ArenaSandboxPolicy,
  ArenaSubjectManifest,
  ArenaSubjectSource,
  ArenaTrustLevel,
  CreateArenaRunInput,
  PrepareArenaRuntimeInput,
} from './types';

export const ARENA_REVIEW_MODES: ArenaReviewMode[] = ['base_skill', 'role_skill', 'role'];

export const ARENA_DECISIONS: ArenaDecision[] = ['pass', 'unstable', 'reopened', 'blocked', 'unsafe'];

export const DEFAULT_PACKAGED_BASE_SKILLS = [...DEFAULT_BUNDLED_BASE_SKILLS];

export const BASE_TOOL_NAMES = [
  'read_file',
  'write_file',
  'edit_file',
  'glob',
  'grep',
  'execute_shell',
  'spawn_subagent',
  'check_subagent',
  'stop_subagent',
  'resume_subagent',
  'ask_parent',
  'skill',
];

export const SURFACE_TOOL_NAMES = ['send_text', 'send_file'];

const CHANNEL_BACKED_SURFACES = new Set(['pet', 'dashboard', 'feishu', 'weixin']);
const DEFAULT_SURFACE = 'pet';
const DEFAULT_SANDBOX_TIMEOUT_MS = 120_000;

export interface ArenaManagerOptions {
  projectRoot?: string;
  now?: () => Date;
  createId?: (parts: string[]) => string;
}

export interface ImportLocalSkillOptions {
  skillPath: string;
  trustLevel?: ArenaTrustLevel;
  allowedRuntime?: ArenaAllowedRuntime;
}

export interface ImportGithubSkillOptions {
  repo: string;
  ref?: string;
  trustLevel?: ArenaTrustLevel;
  allowedRuntime?: ArenaAllowedRuntime;
}

export interface SnapshotRoleOptions {
  roleId: string;
  trustLevel?: ArenaTrustLevel;
  allowedRuntime?: ArenaAllowedRuntime;
}

export class ArenaManager {
  private readonly projectRoot: string;
  private readonly now: () => Date;
  private readonly createId: (parts: string[]) => string;

  constructor(options: ArenaManagerOptions = {}) {
    this.projectRoot = path.resolve(options.projectRoot || PathResolver.getProjectRoot());
    this.now = options.now || (() => new Date());
    this.createId = options.createId || ((parts: string[]) => defaultId(parts));
  }

  getArenaRoot(): string {
    return path.join(this.projectRoot, 'arena');
  }

  getSubjectsRoot(): string {
    return path.join(this.getArenaRoot(), 'subjects');
  }

  getRunsRoot(): string {
    return path.join(this.getArenaRoot(), 'runs');
  }

  importLocalSkill(options: ImportLocalSkillOptions): ArenaSubjectManifest {
    const skillFile = resolveSkillFile(this.projectRoot, options.skillPath);
    const skill = SkillParser.parse(skillFile);
    const subjectId = this.createId(['skill', skill.metadata.name, skillFile]);
    const subjectDir = path.join(this.getSubjectsRoot(), subjectId);
    ensureDir(subjectDir);

    const parsed = {
      docs: relativeExistingFiles(this.projectRoot, [skillFile]),
      prompt_files: [] as string[],
      skill_files: relativeExistingFiles(this.projectRoot, [skillFile]),
      declared_tools: [...(skill.metadata.toolsets || [])],
    };
    const fingerprint = fingerprintFiles([skillFile]);
    const manifest = this.buildManifest({
      subjectId,
      type: 'skill',
      source: {
        type: 'local_skill',
        path: relativePath(this.projectRoot, skillFile),
      },
      name: skill.metadata.name,
      description: skill.metadata.description,
      capabilities: [skill.metadata.description],
      requiredTools: parsed.declared_tools,
      parsed,
      safety: scanSafety([skillFile]),
      trustLevel: options.trustLevel || 'review_required',
      allowedRuntime: options.allowedRuntime || 'arena_only',
      fingerprint,
    });

    return this.writeSubjectManifest(subjectDir, manifest);
  }

  importGithubSkill(options: ImportGithubSkillOptions): ArenaSubjectManifest {
    const { owner, repo } = parseGithubRepo(options.repo);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-arena-skill-'));
    const repoUrl = `https://github.com/${owner}/${repo}.git`;
    try {
      execFileSync('git', ['clone', repoUrl, tmpDir], { stdio: 'ignore' });
      if (options.ref) {
        execFileSync('git', ['checkout', options.ref], { cwd: tmpDir, stdio: 'ignore' });
      }
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir, encoding: 'utf-8' }).trim();
      const skillFiles = PathResolver.findSkillFiles(tmpDir);
      if (skillFiles.length === 0) {
        throw new Error(`No SKILL.md found in ${options.repo}`);
      }
      const skillFile = skillFiles[0];
      const skill = SkillParser.parse(skillFile);
      const subjectId = this.createId(['skill', owner, repo, commit, skill.metadata.name]);
      const subjectDir = path.join(this.getSubjectsRoot(), subjectId);
      const sourceDir = path.join(subjectDir, 'source');
      ensureDir(subjectDir);
      copyDirectory(tmpDir, sourceDir);

      const persistedSkillFile = path.join(sourceDir, path.relative(tmpDir, skillFile));
      const parsed = {
        docs: relativeExistingFiles(this.projectRoot, [persistedSkillFile]),
        prompt_files: [] as string[],
        skill_files: relativeExistingFiles(this.projectRoot, [persistedSkillFile]),
        declared_tools: [...(skill.metadata.toolsets || [])],
      };
      const manifest = this.buildManifest({
        subjectId,
        type: 'skill',
        source: {
          type: 'github',
          owner,
          repo,
          ref: options.ref,
          commit,
          url: repoUrl,
          path: relativePath(this.projectRoot, sourceDir),
        },
        name: skill.metadata.name,
        description: skill.metadata.description,
        capabilities: [skill.metadata.description],
        requiredTools: parsed.declared_tools,
        parsed,
        safety: scanSafety([persistedSkillFile]),
        trustLevel: options.trustLevel || 'untrusted',
        allowedRuntime: options.allowedRuntime || 'arena_only',
        fingerprint: fingerprintFiles([persistedSkillFile]),
      });

      return this.writeSubjectManifest(subjectDir, manifest);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  snapshotRole(options: SnapshotRoleOptions): ArenaSubjectManifest {
    const role = RoleManager.getRole(options.roleId);
    if (!role) {
      throw new Error(`Role not found: ${options.roleId}`);
    }

    const roleFiles = collectRoleFiles(role.path);
    const localSkillFiles = PathResolver.findSkillFiles(path.join(role.path, 'skills'));
    const localSkills = localSkillFiles.map(file => SkillParser.parse(file).metadata.name).sort();
    const docs = roleFiles
      .filter(file => isDocFile(file))
      .map(file => relativePath(this.projectRoot, file));
    const promptFiles = roleFiles
      .filter(file => file.includes(`${path.sep}prompts${path.sep}`))
      .map(file => relativePath(this.projectRoot, file));
    const declaredBoundaries = [
      role.description,
      role.config?.metadata?.boundary,
      role.config?.metadata?.responsibility,
    ]
      .map(value => typeof value === 'string' ? value.trim() : '')
      .filter(Boolean);
    const declaredTools = [
      ...(role.config?.baseToolAllowlist || []),
      ...(role.config?.toolVisibility?.defaultTools || []),
    ].map(String).filter(Boolean);
    const subjectId = this.createId(['role', role.name, fingerprintFiles(roleFiles)]);
    const subjectDir = path.join(this.getSubjectsRoot(), subjectId);
    ensureDir(subjectDir);

    const manifest = this.buildManifest({
      subjectId,
      type: 'role',
      source: {
        type: 'local_role',
        path: relativePath(this.projectRoot, role.path),
      },
      name: role.name,
      description: role.description || role.displayName,
      capabilities: [role.description || role.displayName],
      requiredTools: declaredTools,
      parsed: {
        docs,
        prompt_files: promptFiles,
        skill_files: localSkillFiles.map(file => relativePath(this.projectRoot, file)),
        declared_tools: declaredTools,
      },
      safety: scanSafety(roleFiles),
      trustLevel: options.trustLevel || 'review_required',
      allowedRuntime: options.allowedRuntime || 'arena_only',
      fingerprint: fingerprintFiles(roleFiles),
      role: {
        id: role.name,
        docs,
        local_skills: localSkills,
        declared_boundaries: declaredBoundaries,
        fingerprint: fingerprintFiles(roleFiles),
      },
    });

    return this.writeSubjectManifest(subjectDir, manifest);
  }

  readSubjectManifest(subjectIdOrPath: string): ArenaSubjectManifest {
    const manifestPath = this.resolveSubjectManifestPath(subjectIdOrPath);
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ArenaSubjectManifest;
  }

  createRunIndex(input: CreateArenaRunInput): ArenaRunIndex {
    const subject = this.readSubjectManifest(input.subjectId);
    this.validateModeAndSubject(input.reviewMode, subject, input.targetRoleId);
    const runId = safeSegment(input.runId || this.createId(['run', input.reviewMode, subject.subject_id, this.now().toISOString()]));
    const runDir = path.join(this.getRunsRoot(), runId);
    ensureDir(runDir);
    const surface = input.surface || DEFAULT_SURFACE;
    const replayAttempts = normalizeReplayAttempts(input.replayAttempts);
    validateDecisionEvidence(input.decision, input.reviewerRef, replayAttempts);
    this.validateEvidenceRefs(input, replayAttempts);

    const sandbox = this.buildSandboxPolicy(subject, input.sandbox);
    const runIndex: ArenaRunIndex = {
      version: 1,
      run_id: runId,
      review_mode: input.reviewMode,
      subject_id: subject.subject_id,
      subject_manifest_path: relativePath(this.projectRoot, this.resolveSubjectManifestPath(subject.subject_id)),
      target_profile: this.buildTargetProfile({
        reviewMode: input.reviewMode,
        subject,
        targetRoleId: input.targetRoleId,
        surface,
      }),
      usercat_run_ref: {
        ...input.usercatRunRef,
        trace_refs: input.usercatRunRef.trace_refs || input.traceRefs,
      },
      trace_refs: [...input.traceRefs],
      inspector_refs: [...(input.inspectorRefs || [])],
      ...(input.reviewerRef && { reviewer_ref: input.reviewerRef }),
      replay_attempts: replayAttempts,
      sandbox,
      decision: input.decision,
      scorecard_summary: input.scorecardSummary || '',
      promotion: input.promotion || {},
      created_at: this.now().toISOString(),
    };

    validateRunIndex(runIndex);
    writeJson(path.join(runDir, 'arena-run.json'), runIndex);
    return runIndex;
  }

  prepareCleanRuntime(input: PrepareArenaRuntimeInput): ArenaCleanRuntimeIndex {
    const subject = this.readSubjectManifest(input.subjectId);
    this.validateModeAndSubject(input.reviewMode, subject, input.targetRoleId);
    const runId = safeSegment(input.runId || this.createId([
      'clean-runtime',
      input.reviewMode,
      subject.subject_id,
      this.now().toISOString(),
    ]));
    const runRoot = path.join(this.getRunsRoot(), runId);
    const roots = {
      run_root: runRoot,
      home_root: path.join(runRoot, 'home'),
      skills_root: path.join(runRoot, 'skills'),
      roles_root: path.join(runRoot, 'roles'),
      workspace_root: path.join(runRoot, 'workspace'),
      tmp_root: path.join(runRoot, 'tmp'),
    };
    resetRuntimeRoots([
      roots.home_root,
      roots.skills_root,
      roots.roles_root,
      roots.workspace_root,
      roots.tmp_root,
      path.join(runRoot, 'sandbox'),
    ]);
    Object.values(roots).forEach(ensureDir);

    const registryFiles = [
      path.join(roots.home_root, 'skill-registry.json'),
      path.join(roots.workspace_root, 'skill-registry.json'),
    ];
    for (const registryFile of registryFiles) {
      writeJson(registryFile, []);
    }
    const copiedWorkspaceSeed = input.workspaceSeedPath
      ? copyWorkspaceSeed(this.projectRoot, input.workspaceSeedPath, roots.workspace_root)
      : undefined;

    const copiedBaseSkills = copyBaseSkills(this.projectRoot, roots.skills_root);
    const copiedSubjectSkill = subject.subject.type === 'skill'
      ? this.copySubjectSkill(subject, roots.skills_root)
      : undefined;
    const copiedRole = input.reviewMode === 'base_skill'
      ? undefined
      : this.copyTargetRole(subject, input.reviewMode, input.targetRoleId, roots.roles_root);
    const surface = input.surface || DEFAULT_SURFACE;
    const targetProfile = this.buildTargetProfile({
      reviewMode: input.reviewMode,
      subject,
      targetRoleId: input.targetRoleId,
      surface,
    });
    const sandboxSubjectRoot = copiedSubjectSkill
      ? path.join(runRoot, copiedSubjectSkill)
      : copiedRole
        ? path.join(runRoot, copiedRole)
        : roots.workspace_root;
    const passThroughEnv = normalizeEnvNames([
      ...subject.default_sandbox.env_allowlist,
      ...(input.sandbox?.env_allowlist || []),
      ...(input.passThroughEnv || []),
    ]);
    const sandbox = this.buildSandboxPolicy(subject, {
      ...input.sandbox,
      workspace_root: input.sandbox?.workspace_root || roots.workspace_root,
      subject_root: input.sandbox?.subject_root || sandboxSubjectRoot,
      writable_roots: input.sandbox?.writable_roots || [
        roots.home_root,
        roots.workspace_root,
        roots.tmp_root,
      ],
      env_allowlist: passThroughEnv,
    });
    const launchEnv = buildCleanRuntimeEnv({
      projectRoot: this.projectRoot,
      homeRoot: roots.home_root,
      skillsRoot: roots.skills_root,
      rolesRoot: roots.roles_root,
      tmpRoot: roots.tmp_root,
    });
    const command = buildLaunchCommand(this.projectRoot, targetProfile.active_role_id);
    const sandboxProfilePath = sandbox.engine === 'macos_seatbelt'
      ? writeMacSeatbeltProfile({
        runRoot,
        projectRoot: this.projectRoot,
        roots,
        sandbox,
      })
      : undefined;
    const launch = {
      cwd: roots.workspace_root,
      command,
      env: launchEnv,
      pass_through_env: passThroughEnv,
      shell_command: buildShellCommand({
        cwd: roots.workspace_root,
        command,
        env: launchEnv,
        passThroughEnv,
      }),
      ...(sandboxProfilePath && {
        sandbox_profile_path: sandboxProfilePath,
        sandbox_shell_command: buildShellCommand({
          cwd: roots.workspace_root,
          command,
          env: launchEnv,
          passThroughEnv,
          sandboxProfilePath,
        }),
      }),
    };
    const runtimeIndex: ArenaCleanRuntimeIndex = {
      version: 1,
      run_id: runId,
      review_mode: input.reviewMode,
      subject_id: subject.subject_id,
      subject_manifest_path: relativePath(this.projectRoot, this.resolveSubjectManifestPath(subject.subject_id)),
      target_profile: targetProfile,
      roots,
      copied: {
        base_skills: copiedBaseSkills.copied,
        missing_base_skills: copiedBaseSkills.missing,
        ...(copiedSubjectSkill && { subject_skill: copiedSubjectSkill }),
        ...(copiedRole && { role: copiedRole }),
        ...(copiedWorkspaceSeed && { workspace_seed: copiedWorkspaceSeed }),
      },
      isolation: {
        production_skills_root: path.join(this.projectRoot, 'skills'),
        production_roles_root: path.join(this.projectRoot, 'roles'),
        production_home_root: process.env.XIAOBA_HOME || process.env.HOME,
        registry_files: registryFiles,
      },
      sandbox,
      launch,
      created_at: this.now().toISOString(),
    };

    writeJson(path.join(runRoot, 'clean-runtime.json'), runtimeIndex);
    return runtimeIndex;
  }

  private buildManifest(input: {
    subjectId: string;
    type: 'skill' | 'role';
    source: ArenaSubjectSource;
    name: string;
    description: string;
    capabilities: string[];
    requiredTools: string[];
    parsed: ArenaSubjectManifest['parsed'];
    safety: ArenaSubjectManifest['safety'];
    trustLevel: ArenaTrustLevel;
    allowedRuntime: ArenaAllowedRuntime;
    fingerprint: string;
    role?: ArenaSubjectManifest['role'];
  }): ArenaSubjectManifest {
    return {
      version: 1,
      subject_id: input.subjectId,
      subject: {
        type: input.type,
        name: input.name,
        description: input.description,
        capabilities: input.capabilities,
        required_tools: input.requiredTools,
      },
      source: input.source,
      parsed: input.parsed,
      safety: input.safety,
      trust_level: input.trustLevel,
      allowed_runtime: input.allowedRuntime,
      default_sandbox: defaultSandboxForTrust(input.trustLevel),
      fingerprint: input.fingerprint,
      created_at: this.now().toISOString(),
      ...(input.role && { role: input.role }),
    };
  }

  private writeSubjectManifest(subjectDir: string, manifest: ArenaSubjectManifest): ArenaSubjectManifest {
    writeJson(path.join(subjectDir, 'arena-manifest.json'), manifest);
    return manifest;
  }

  private copySubjectSkill(subject: ArenaSubjectManifest, skillsRoot: string): string {
    const subjectSkillName = safeSegment(subject.subject.name);
    const destination = path.join(skillsRoot, subjectSkillName);
    const sourceDir = resolveSubjectSkillSourceDir(this.projectRoot, subject);
    copyDirectory(sourceDir, destination);
    return relativePath(path.dirname(skillsRoot), destination);
  }

  private copyTargetRole(
    subject: ArenaSubjectManifest,
    reviewMode: ArenaReviewMode,
    targetRoleId: string | undefined,
    rolesRoot: string,
  ): string {
    const requestedRoleId = targetRoleId?.trim();
    if (!requestedRoleId) {
      throw new Error(`${reviewMode} requires targetRoleId`);
    }
    const role = reviewMode === 'role'
      ? undefined
      : RoleManager.getRole(requestedRoleId);
    const sourceDir = reviewMode === 'role'
      ? resolveSubjectRoleSourceDir(this.projectRoot, subject)
      : role?.path;
    if (!sourceDir || !fs.existsSync(sourceDir)) {
      throw new Error(`Role not found: ${requestedRoleId}`);
    }

    const destinationName = safeSegment(role?.name || requestedRoleId);
    const destination = path.join(rolesRoot, destinationName);
    copyDirectory(sourceDir, destination);
    return relativePath(path.dirname(rolesRoot), destination);
  }

  private resolveSubjectManifestPath(subjectIdOrPath: string): string {
    const value = subjectIdOrPath.trim();
    if (!value) {
      throw new Error('subject id is required');
    }
    if (value.endsWith('arena-manifest.json')) {
      return path.resolve(this.projectRoot, value);
    }
    return path.join(this.getSubjectsRoot(), safeSegment(value), 'arena-manifest.json');
  }

  private validateModeAndSubject(
    reviewMode: ArenaReviewMode,
    subject: ArenaSubjectManifest,
    targetRoleId?: string,
  ): void {
    if (!ARENA_REVIEW_MODES.includes(reviewMode)) {
      throw new Error(`Unsupported review mode: ${reviewMode}`);
    }
    if ((reviewMode === 'base_skill' || reviewMode === 'role_skill') && subject.subject.type !== 'skill') {
      throw new Error(`${reviewMode} requires subject.type=skill`);
    }
    if (reviewMode === 'role' && subject.subject.type !== 'role') {
      throw new Error('role review mode requires subject.type=role');
    }
    if ((reviewMode === 'role_skill' || reviewMode === 'role') && !targetRoleId?.trim()) {
      throw new Error(`${reviewMode} requires targetRoleId`);
    }
  }

  private buildSandboxPolicy(
    subject: ArenaSubjectManifest,
    override: Partial<ArenaSandboxPolicy> | undefined,
  ): ArenaSandboxPolicy {
    const subjectRoot = subject.source.path || path.dirname(this.resolveSubjectManifestPath(subject.subject_id));
    const workspaceRoot = override?.workspace_root || path.join(this.getRunsRoot(), '.workspaces', subject.subject_id);
    return {
      engine: override?.engine || defaultSandboxEngine(),
      mode: override?.mode || subject.default_sandbox.mode,
      workspace_root: workspaceRoot,
      subject_root: override?.subject_root || subjectRoot,
      writable_roots: override?.writable_roots || [workspaceRoot],
      network: override?.network || subject.default_sandbox.network,
      env_allowlist: override?.env_allowlist || [...subject.default_sandbox.env_allowlist],
      timeout_ms: override?.timeout_ms || subject.default_sandbox.timeout_ms,
    };
  }

  private buildTargetProfile(input: {
    reviewMode: ArenaReviewMode;
    subject: ArenaSubjectManifest;
    targetRoleId?: string;
    surface: string;
  }): ArenaRunIndex['target_profile'] {
    const activeRoleId = input.reviewMode === 'base_skill' ? 'base' : input.targetRoleId;
    const subjectSkillId = input.subject.subject.type === 'skill' ? input.subject.subject.name : undefined;
    const roleLocalSkills = activeRoleId && activeRoleId !== 'base'
      ? collectRoleLocalSkillNames(activeRoleId)
      : [];
    const loadedSkills = Array.from(new Set([
      ...DEFAULT_PACKAGED_BASE_SKILLS,
      ...(roleLocalSkills || []),
      ...(subjectSkillId ? [subjectSkillId] : []),
    ]));
    const registeredTools = Array.from(new Set([
      ...BASE_TOOL_NAMES,
      ...(CHANNEL_BACKED_SURFACES.has(input.surface) ? SURFACE_TOOL_NAMES : []),
    ]));

    return {
      ...(activeRoleId && { active_role_id: activeRoleId }),
      ...(subjectSkillId && { subject_skill_id: subjectSkillId }),
      loaded_skills: loadedSkills,
      role_local_skills: roleLocalSkills,
      registered_tools: registeredTools,
      provider_visible_tools: registeredTools,
      surface: input.surface,
    };
  }

  private validateEvidenceRefs(input: CreateArenaRunInput, replayAttempts: ArenaReplayAttempts): void {
    assertLocalRefExists(this.projectRoot, input.usercatRunRef.package_path, 'usercat_run_ref.package_path');
    for (const [index, traceRef] of input.traceRefs.entries()) {
      assertLocalRefExists(this.projectRoot, traceRef, `trace_refs[${index}]`);
    }
    for (const [index, traceRef] of (input.usercatRunRef.trace_refs || []).entries()) {
      assertLocalRefExists(this.projectRoot, traceRef, `usercat_run_ref.trace_refs[${index}]`);
    }
    for (const [index, inspectorRef] of (input.inspectorRefs || []).entries()) {
      assertLocalRefExists(this.projectRoot, inspectorRef, `inspector_refs[${index}]`);
    }
    for (const [index, replayTraceRef] of replayAttempts.trace_refs.entries()) {
      assertLocalRefExists(this.projectRoot, replayTraceRef, `replay_attempts.trace_refs[${index}]`);
    }
    if (input.reviewerRef) {
      assertLocalRefExists(this.projectRoot, input.reviewerRef.scorecard_path, 'reviewer_ref.scorecard_path');
      assertLocalRefExists(this.projectRoot, input.reviewerRef.report_path, 'reviewer_ref.report_path');
    }
  }
}

function resetRuntimeRoots(paths: string[]): void {
  for (const rootPath of paths) {
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
}

function copyBaseSkills(projectRoot: string, skillsRoot: string): { copied: string[]; missing: string[] } {
  const copied: string[] = [];
  const missing: string[] = [];
  for (const skillName of DEFAULT_PACKAGED_BASE_SKILLS) {
    const sourceDir = path.join(projectRoot, 'skills', skillName);
    if (!fs.existsSync(sourceDir)) {
      missing.push(skillName);
      continue;
    }
    copyDirectory(sourceDir, path.join(skillsRoot, skillName));
    copied.push(skillName);
  }
  return { copied, missing };
}

function copyWorkspaceSeed(projectRoot: string, seedPath: string, workspaceRoot: string): { source: string; file_count: number } {
  const source = path.resolve(projectRoot, seedPath);
  if (!fs.existsSync(source)) {
    throw new Error(`Workspace seed path does not exist: ${seedPath}`);
  }
  if (!fs.statSync(source).isDirectory()) {
    throw new Error(`Workspace seed path must be a directory: ${seedPath}`);
  }
  copyDirectory(source, workspaceRoot);
  return {
    source: relativePath(projectRoot, source),
    file_count: countFiles(source),
  };
}

function resolveSubjectSkillSourceDir(projectRoot: string, subject: ArenaSubjectManifest): string {
  const sourcePath = resolveSubjectSourcePath(projectRoot, subject);
  if (subject.source.type === 'github' && sourcePath && fs.existsSync(sourcePath) && fs.statSync(sourcePath).isDirectory()) {
    return sourcePath;
  }
  const skillFile = firstExistingPath(projectRoot, [
    ...subject.parsed.skill_files,
    ...(sourcePath ? [sourcePath] : []),
  ]);
  if (!skillFile) {
    throw new Error(`Skill source not found for subject: ${subject.subject_id}`);
  }
  return fs.statSync(skillFile).isDirectory() ? skillFile : path.dirname(skillFile);
}

function resolveSubjectRoleSourceDir(projectRoot: string, subject: ArenaSubjectManifest): string {
  const sourcePath = resolveSubjectSourcePath(projectRoot, subject);
  if (sourcePath && fs.existsSync(sourcePath) && fs.statSync(sourcePath).isDirectory()) {
    return sourcePath;
  }
  throw new Error(`Role source not found for subject: ${subject.subject_id}`);
}

function resolveSubjectSourcePath(projectRoot: string, subject: ArenaSubjectManifest): string | undefined {
  if (!subject.source.path) {
    return undefined;
  }
  return path.resolve(projectRoot, subject.source.path);
}

function firstExistingPath(projectRoot: string, refs: string[]): string | undefined {
  for (const ref of refs) {
    const value = String(ref || '').trim();
    if (!value) {
      continue;
    }
    const absolutePath = path.resolve(projectRoot, value);
    if (fs.existsSync(absolutePath)) {
      return absolutePath;
    }
  }
  return undefined;
}

function buildCleanRuntimeEnv(input: {
  projectRoot: string;
  homeRoot: string;
  skillsRoot: string;
  rolesRoot: string;
  tmpRoot: string;
}): Record<string, string> {
  const dotenvPath = resolveArenaDotenvPath(input.projectRoot);
  return {
    XIAOBA_ARENA: '1',
    XIAOBA_HOME: input.homeRoot,
    XIAOBA_PROJECT_ROOT: input.projectRoot,
    XIAOBA_SKILLS_ROOT: input.skillsRoot,
    XIAOBA_ROLES_ROOT: input.rolesRoot,
    HOME: input.homeRoot,
    TMPDIR: input.tmpRoot,
    NO_COLOR: '1',
    ...(dotenvPath && { DOTENV_CONFIG_PATH: dotenvPath }),
  };
}

function resolveArenaDotenvPath(projectRoot: string): string | undefined {
  const explicitPath = String(process.env.DOTENV_CONFIG_PATH || '').trim();
  const candidates = [
    explicitPath
      ? path.resolve(projectRoot, explicitPath)
      : '',
    path.join(projectRoot, '.env'),
  ];
  return candidates.find(candidate => Boolean(candidate) && fs.existsSync(candidate));
}

function buildLaunchCommand(projectRoot: string, activeRoleId?: string): string[] {
  const command = [
    process.execPath,
    path.join(projectRoot, 'dist', 'index.js'),
    'chat',
    '--interactive',
  ];
  if (activeRoleId && activeRoleId !== 'base') {
    command.push('--role', activeRoleId);
  }
  return command;
}

function buildShellCommand(input: {
  cwd: string;
  command: string[];
  env: Record<string, string>;
  passThroughEnv: string[];
  sandboxProfilePath?: string;
}): string {
  const env = input.sandboxProfilePath
    ? { ...input.env, XIAOBA_ARENA_SANDBOXED: '1' }
    : input.env;
  const envParts = Object.entries(env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${shellQuote(value)}`);
  for (const envName of input.passThroughEnv) {
    envParts.push(`${envName}="\${${envName}}"`);
  }
  const commandParts = input.command.map(shellQuote);
  const spawnCommand = ['env', '-i', ...envParts, ...commandParts].join(' ');
  const wrappedCommand = input.sandboxProfilePath
    ? ['sandbox-exec', '-f', shellQuote(input.sandboxProfilePath), spawnCommand].join(' ')
    : spawnCommand;
  return `cd ${shellQuote(input.cwd)} && ${wrappedCommand}`;
}

function writeMacSeatbeltProfile(input: {
  runRoot: string;
  projectRoot: string;
  roots: ArenaCleanRuntimeIndex['roots'];
  sandbox: ArenaSandboxPolicy;
}): string {
  const sandboxDir = path.join(input.runRoot, 'sandbox');
  ensureDir(sandboxDir);
  const profilePath = path.join(sandboxDir, 'macos-seatbelt.sb');
  const readRoots = uniqueExistingPaths([
    input.projectRoot,
    input.runRoot,
    path.dirname(process.execPath),
    '/dev',
    '/System',
    '/Library',
    '/usr',
    '/bin',
    '/sbin',
    '/etc',
    '/private/etc',
    '/private/var/db/timezone',
    '/var/db/timezone',
    '/opt/homebrew',
  ]);
  const writeRoots = uniqueExistingPaths([
    input.runRoot,
    input.roots.home_root,
    input.roots.workspace_root,
    input.roots.tmp_root,
  ]);
  const readRules = readRoots
    .map(root => `(allow file-read* (subpath ${seatbeltString(root)}))`)
    .join('\n');
  const writeRules = writeRoots
    .map(root => `(allow file-write* (subpath ${seatbeltString(root)}))`)
    .join('\n');
  // The Pet/Chat entrypoint starts a loopback HTTP server. Seatbelt's granular
  // loopback filters are inconsistent for Node bind(127.0.0.1), so Arena's
  // macOS profile treats network as a cleanliness boundary in metadata while
  // allowing process-local networking for the real product surface.
  const networkRule = '(allow network*)';
  const profile = [
    '(version 1)',
    '(deny default)',
    '(allow process*)',
    '(allow mach-lookup)',
    '(allow sysctl*)',
    '(allow file-map-executable)',
    '(allow file-read-metadata)',
    '(allow file-read*)',
    '(allow file-write-data (subpath "/dev"))',
    readRules,
    writeRules,
    networkRule,
    '',
  ].filter(Boolean).join('\n');
  fs.writeFileSync(profilePath, profile, 'utf-8');
  return profilePath;
}

function normalizeEnvNames(values: string[]): string[] {
  const names = values
    .map(value => value.trim())
    .filter(value => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value));
  return Array.from(new Set(names)).sort();
}

function uniqueExistingPaths(values: string[]): string[] {
  return Array.from(new Set(
    values
      .map(value => path.resolve(value))
      .filter(value => fs.existsSync(value)),
  ));
}

function seatbeltString(value: string): string {
  return `"${path.resolve(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function resolveSkillFile(projectRoot: string, value: string): string {
  const resolved = path.resolve(projectRoot, value);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    const skillFile = path.join(resolved, 'SKILL.md');
    if (fs.existsSync(skillFile)) {
      return skillFile;
    }
  }
  if (fs.existsSync(resolved) && path.basename(resolved) === 'SKILL.md') {
    return resolved;
  }
  throw new Error(`Skill path must point to SKILL.md or a skill directory: ${value}`);
}

function parseGithubRepo(repo: string): { owner: string; repo: string } {
  const match = repo.trim().match(/^([^/]+)\/([^/]+)$/);
  if (!match) {
    throw new Error('GitHub repo must use owner/repo format');
  }
  return { owner: match[1], repo: match[2] };
}

function defaultSandboxForTrust(trustLevel: ArenaTrustLevel): ArenaDefaultSandbox {
  return {
    engine: defaultSandboxEngine(),
    mode: trustLevel === 'untrusted' ? 'metadata_only' : 'read_only',
    network: 'disabled',
    env_allowlist: [],
    timeout_ms: DEFAULT_SANDBOX_TIMEOUT_MS,
  };
}

function defaultSandboxEngine(): ArenaSandboxPolicy['engine'] {
  if (process.platform === 'darwin') return 'macos_seatbelt';
  if (process.platform === 'linux') return 'linux_bubblewrap';
  if (process.platform === 'win32') return 'windows_native';
  return 'none';
}

function collectRoleLocalSkillNames(roleId: string): string[] {
  const role = RoleManager.getRole(roleId);
  if (!role) {
    return [];
  }
  return PathResolver.findSkillFiles(path.join(role.path, 'skills'))
    .map(file => SkillParser.parse(file).metadata.name)
    .sort();
}

function collectRoleFiles(rolePath: string): string[] {
  const files: string[] = [];
  walk(rolePath, files);
  return files.sort();
}

function walk(dirPath: string, files: string[]): void {
  if (!fs.existsSync(dirPath)) return;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
}

function isDocFile(filePath: string): boolean {
  const baseName = path.basename(filePath).toLowerCase();
  return baseName === 'readme.md'
    || baseName === 'spec.md'
    || baseName === 'plan.md'
    || baseName.endsWith('.md');
}

function scanSafety(filePaths: string[]): ArenaSubjectManifest['safety'] {
  const warnings: string[] = [];
  const patterns = [
    { re: /\brm\s+-rf\b/i, label: 'destructive rm -rf instruction' },
    { re: /\bcurl\b.+\|\s*(?:sh|bash)\b/i, label: 'curl pipe shell instruction' },
    { re: /\b(api[_-]?key|token|secret|password)\b/i, label: 'mentions credentials or secrets' },
    { re: /\b(send email|send mail|发邮件|发送邮件|付款|支付|delete remote|删除远端)\b/i, label: 'mentions external side effects' },
  ];

  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size > 256_000) {
      continue;
    }
    const text = fs.readFileSync(filePath, 'utf-8');
    for (const pattern of patterns) {
      if (pattern.re.test(text)) {
        warnings.push(`${pattern.label}: ${relativePath(process.cwd(), filePath)}`);
      }
    }
  }

  return {
    risk_level: warnings.some(warning => warning.includes('destructive') || warning.includes('curl pipe'))
      ? 'high'
      : warnings.length > 0 ? 'medium' : 'low',
    warnings,
  };
}

function fingerprintFiles(filePaths: string[]): string {
  const hash = crypto.createHash('sha256');
  for (const filePath of [...filePaths].sort()) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      continue;
    }
    hash.update(path.basename(filePath));
    hash.update('\0');
    hash.update(fs.readFileSync(filePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function normalizeReplayAttempts(value: Partial<ArenaReplayAttempts> | undefined): ArenaReplayAttempts {
  const planned = nonNegativeInt(value?.planned, 0);
  const passCount = nonNegativeInt(value?.pass_count, 0);
  const failCount = nonNegativeInt(value?.fail_count, 0);
  const blockedCount = nonNegativeInt(value?.blocked_count, 0);
  const completed = nonNegativeInt(value?.completed, passCount + failCount + blockedCount);
  return {
    planned,
    completed,
    pass_count: passCount,
    fail_count: failCount,
    blocked_count: blockedCount,
    trace_refs: [...(value?.trace_refs || [])],
  };
}

function validateDecisionEvidence(
  decision: ArenaDecision,
  reviewerRef: unknown,
  attempts: ArenaReplayAttempts,
): void {
  if (!ARENA_DECISIONS.includes(decision)) {
    throw new Error(`Unsupported Arena decision: ${decision}`);
  }
  if (!reviewerRef) {
    throw new Error(`${decision} requires reviewer_ref`);
  }
  if (decision === 'pass') {
    if (attempts.fail_count > 0 || attempts.blocked_count > 0) {
      throw new Error('pass requires no failed or blocked replay attempts');
    }
    if (attempts.planned > 0 && attempts.completed <= 0) {
      throw new Error('pass with planned replay attempts requires completed replay attempts');
    }
  }
  if (decision === 'unstable' && !(attempts.pass_count > 0 && attempts.fail_count + attempts.blocked_count > 0)) {
    throw new Error('unstable requires mixed replay attempt results');
  }
  if (decision === 'reopened' && attempts.fail_count <= 0) {
    throw new Error('reopened requires at least one failed replay attempt');
  }
}

function validateRunIndex(runIndex: ArenaRunIndex): void {
  if (!runIndex.usercat_run_ref.run_id || !runIndex.usercat_run_ref.package_path) {
    throw new Error('usercat_run_ref.run_id and package_path are required');
  }
  if (runIndex.trace_refs.length === 0) {
    throw new Error('trace_refs must include native runtime evidence');
  }
  if (runIndex.decision !== 'blocked' && runIndex.inspector_refs.length === 0) {
    throw new Error(`${runIndex.decision} requires Inspector evidence refs`);
  }
}

function assertLocalRefExists(projectRoot: string, ref: string, field: string): void {
  const normalizedRef = String(ref || '').trim();
  if (!normalizedRef) {
    throw new Error(`${field} is required`);
  }
  const filePart = normalizedRef.split('#')[0];
  const absolutePath = path.resolve(projectRoot, filePart);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`${field} does not exist: ${normalizedRef}`);
  }
}

function nonNegativeInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function writeJson(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'arena-item';
}

function defaultId(parts: string[]): string {
  const readable = safeSegment(parts.find(part => part && !part.includes('/')) || 'arena');
  const hash = crypto
    .createHash('sha256')
    .update(parts.join('\0'))
    .digest('hex')
    .slice(0, 10);
  return `${readable}-${hash}`;
}

function relativeExistingFiles(root: string, filePaths: string[]): string[] {
  return filePaths
    .filter(filePath => fs.existsSync(filePath))
    .map(filePath => relativePath(root, filePath));
}

function relativePath(root: string, filePath: string): string {
  const absolute = path.resolve(root, filePath);
  return path.relative(root, absolute) || '.';
}

function copyDirectory(from: string, to: string): void {
  ensureDir(to);
  fs.cpSync(from, to, {
    recursive: true,
    filter: source => !source.includes(`${path.sep}.git${path.sep}`) && !source.endsWith(`${path.sep}.git`),
  });
}

function countFiles(rootPath: string): number {
  let count = 0;
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      count += countFiles(entryPath);
    } else if (entry.isFile()) {
      count += 1;
    }
  }
  return count;
}
