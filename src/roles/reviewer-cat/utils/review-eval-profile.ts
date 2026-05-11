import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export type ProjectType =
  | 'web'
  | 'cli'
  | 'api'
  | 'desktop'
  | 'agent-runtime'
  | 'robot'
  | 'library'
  | 'data-pipeline'
  | 'mixed'
  | 'unknown';

export type EvalProfileSource = 'existing' | 'existing_with_inferred_defaults' | 'inferred';
export type EvidenceLevel = 'static' | 'unit' | 'integration' | 'smoke' | 'e2e' | 'e2e_boundary';

export interface EvalEntryPoint {
  id: string;
  type: string;
  target: string;
  description: string;
}

export interface CriticalUserPath {
  id: string;
  user: string;
  preconditions: string[];
  steps: string[];
  expectedOutcome: string;
  evidence: string[];
}

export interface ProjectEvalProfile {
  version: 1;
  source: EvalProfileSource;
  sourcePath?: string;
  sourceMarkdown?: string;
  generatedAt: string;
  projectRoot: string;
  projectType: ProjectType;
  detectedProjectTypes: ProjectType[];
  primaryUsers: string[];
  entryPoints: EvalEntryPoint[];
  criticalUserPaths: CriticalUserPath[];
  criticalInvariants: string[];
  environmentPrerequisites: {
    required: string[];
    optional: string[];
    dangerous: string[];
  };
  evidenceThresholds: {
    smoke: string[];
    e2e: string[];
    closed: string[];
  };
  regressionSurface: string[];
  nonAutomatableChecks: Array<{
    check: string;
    reason: string;
    humanOwner: string;
  }>;
  projectBoundaries: {
    allowedScope: string[];
    disallowedScope: string[];
  };
}

export interface ReviewCheck {
  id: string;
  level: EvidenceLevel;
  description: string;
  command?: string;
  action?: string;
  expected: string;
  evidence: string[];
  automatable: boolean;
  riskIfSkipped: string;
}

export interface ReviewLens {
  id: string;
  source: 'test-engineer' | 'code-quality' | 'security' | 'runtime-e2e' | 'debugging';
  focus: string;
  questions: string[];
  requiredEvidence: string[];
  closureImpact: 'blocks_if_failed' | 'raises_risk' | 'informational';
}

export interface ReviewEvalPlan {
  version: 1;
  reviewId: string;
  generatedAt: string;
  cwd: string;
  profileSource: EvalProfileSource;
  profilePath?: string;
  changeUnderReview: {
    request: string;
    changedFiles: string[];
    implementationSummary: string;
  };
  applicableProjectEvalRules: string[];
  acceptanceCriteria: Array<{
    criterion: string;
    evidenceRequired: string[];
    severityIfFailed: 'low' | 'medium' | 'high';
  }>;
  reviewLenses: ReviewLens[];
  requiredChecks: ReviewCheck[];
  optionalChecks: ReviewCheck[];
  blockedChecks: Array<{
    check: string;
    missingPrerequisite: string;
    riskIfSkipped: string;
  }>;
  closureThreshold: string[];
  reopenThreshold: string[];
  manualReviewThreshold: string[];
}

export interface TestMatrixItem {
  id: string;
  userPathOrSystemPath: string;
  level: EvidenceLevel;
  preconditions: string[];
  steps: string[];
  expectedResult: string;
  evidenceSource: string[];
  automatable: boolean;
  status: 'planned' | 'blocked';
  riskIfSkipped: string;
}

export interface ReviewEvalPreparationResult {
  reviewId: string;
  runDir: string;
  profile: ProjectEvalProfile;
  plan: ReviewEvalPlan;
  testMatrix: TestMatrixItem[];
  paths: {
    task: string;
    evaluationProfileMarkdown: string;
    evaluationProfileJson: string;
    reviewEvalPlan: string;
    boundaryMap: string;
    testMatrix: string;
    summary: string;
  };
}

export interface PrepareReviewEvalOptions {
  cwd: string;
  request?: string;
  changedFiles?: string[];
  implementationSummary?: string;
  reviewId?: string;
  outputDir?: string;
}

interface ProjectSignals {
  packageJson?: any;
  packageScripts: Record<string, string>;
  dependencies: Record<string, string>;
  hasIndexHtml: boolean;
  hasSrcIndex: boolean;
  hasRolesDir: boolean;
  hasSkillsDir: boolean;
  hasToolsDir: boolean;
  hasElectronFiles: boolean;
  hasPythonFiles: boolean;
  hasRobotFiles: boolean;
  hasDataPipelineFiles: boolean;
  topLevelFiles: string[];
}

export function prepareReviewEval(options: PrepareReviewEvalOptions): ReviewEvalPreparationResult {
  const cwd = path.resolve(options.cwd);
  const reviewId = safeSegment(options.reviewId || createReviewId());
  const runDir = path.resolve(options.outputDir || path.join(cwd, 'data', 'reviewer-runs', reviewId));
  const changedFiles = (options.changedFiles || []).map(item => item.replace(/\\/g, '/')).filter(Boolean);
  const request = String(options.request || 'Review whether the current project or change is truly usable.').trim();
  const implementationSummary = String(options.implementationSummary || '').trim();

  fs.mkdirSync(runDir, { recursive: true });

  const profile = loadOrInferProjectEvalProfile(cwd);
  const plan = createReviewEvalPlan({
    reviewId,
    cwd,
    request,
    changedFiles,
    implementationSummary,
    profile,
  });
  const testMatrix = createTestMatrix(profile, plan);

  const paths = {
    task: path.join(runDir, 'task.json'),
    evaluationProfileMarkdown: path.join(runDir, 'evaluation-profile.md'),
    evaluationProfileJson: path.join(runDir, 'evaluation-profile.json'),
    reviewEvalPlan: path.join(runDir, 'review-eval-plan.md'),
    boundaryMap: path.join(runDir, 'boundary-map.md'),
    testMatrix: path.join(runDir, 'test-matrix.md'),
    summary: path.join(runDir, 'summary.json'),
  };

  fs.writeFileSync(paths.task, JSON.stringify({
    version: 1,
    reviewId,
    cwd,
    request,
    changedFiles,
    implementationSummary,
    generatedAt: new Date().toISOString(),
  }, null, 2), 'utf-8');
  fs.writeFileSync(paths.evaluationProfileMarkdown, renderProjectEvalProfileMarkdown(profile), 'utf-8');
  fs.writeFileSync(paths.evaluationProfileJson, JSON.stringify(profile, null, 2), 'utf-8');
  fs.writeFileSync(paths.reviewEvalPlan, renderReviewEvalPlanMarkdown(plan), 'utf-8');
  fs.writeFileSync(paths.boundaryMap, renderBoundaryMapMarkdown(profile), 'utf-8');
  fs.writeFileSync(paths.testMatrix, renderTestMatrixMarkdown(testMatrix), 'utf-8');
  fs.writeFileSync(paths.summary, JSON.stringify({
    version: 1,
    reviewId,
    projectType: profile.projectType,
    detectedProjectTypes: profile.detectedProjectTypes,
    profileSource: profile.source,
    requiredChecks: plan.requiredChecks.length,
    optionalChecks: plan.optionalChecks.length,
    blockedChecks: plan.blockedChecks.length,
    testMatrixItems: testMatrix.length,
    paths: mapRelativePaths(paths, cwd),
  }, null, 2), 'utf-8');

  return { reviewId, runDir, profile, plan, testMatrix, paths };
}

export function loadOrInferProjectEvalProfile(cwd: string): ProjectEvalProfile {
  const root = path.resolve(cwd);
  const profileJsonPath = path.join(root, '.reviewercat', 'evaluation-profile.json');
  const profileMdPath = path.join(root, '.reviewercat', 'evaluation-profile.md');
  const inferred = inferProjectEvalProfile(root);

  if (fs.existsSync(profileJsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(profileJsonPath, 'utf-8'));
      return normalizeExistingProfile(parsed, inferred, profileJsonPath);
    } catch {
      return {
        ...inferred,
        source: 'existing_with_inferred_defaults',
        sourcePath: profileJsonPath,
      };
    }
  }

  if (fs.existsSync(profileMdPath)) {
    return {
      ...inferred,
      source: 'existing_with_inferred_defaults',
      sourcePath: profileMdPath,
      sourceMarkdown: truncate(fs.readFileSync(profileMdPath, 'utf-8'), 12000),
    };
  }

  return inferred;
}

function inferProjectEvalProfile(cwd: string): ProjectEvalProfile {
  const signals = inspectProject(cwd);
  const detectedProjectTypes = detectProjectTypes(signals);
  const projectType = detectedProjectTypes.length > 1 ? 'mixed' : detectedProjectTypes[0] || 'unknown';
  const entryPoints = inferEntryPoints(cwd, signals, detectedProjectTypes);
  const criticalUserPaths = inferCriticalUserPaths(projectType, detectedProjectTypes, entryPoints);

  return {
    version: 1,
    source: 'inferred',
    generatedAt: new Date().toISOString(),
    projectRoot: cwd,
    projectType,
    detectedProjectTypes,
    primaryUsers: inferPrimaryUsers(projectType, detectedProjectTypes),
    entryPoints,
    criticalUserPaths,
    criticalInvariants: inferCriticalInvariants(projectType, detectedProjectTypes),
    environmentPrerequisites: inferEnvironmentPrerequisites(projectType, detectedProjectTypes),
    evidenceThresholds: inferEvidenceThresholds(projectType, detectedProjectTypes),
    regressionSurface: inferRegressionSurface(signals, detectedProjectTypes),
    nonAutomatableChecks: inferNonAutomatableChecks(detectedProjectTypes),
    projectBoundaries: {
      allowedScope: ['本次 review 明确授权的文件、模块、链路和测试产物'],
      disallowedScope: ['未授权的公共入口、生产数据、外部服务破坏性操作、与本次需求无关的链路'],
    },
  };
}

function inspectProject(cwd: string): ProjectSignals {
  const packageJson = readJson(path.join(cwd, 'package.json'));
  const dependencies = {
    ...(packageJson?.dependencies || {}),
    ...(packageJson?.devDependencies || {}),
  };
  const topLevelFiles = listTopLevelFiles(cwd);
  return {
    packageJson,
    packageScripts: packageJson?.scripts && typeof packageJson.scripts === 'object' ? packageJson.scripts : {},
    dependencies,
    hasIndexHtml: fs.existsSync(path.join(cwd, 'index.html')) || fs.existsSync(path.join(cwd, 'public', 'index.html')),
    hasSrcIndex: fs.existsSync(path.join(cwd, 'src', 'index.ts')) || fs.existsSync(path.join(cwd, 'src', 'index.js')),
    hasRolesDir: fs.existsSync(path.join(cwd, 'roles')),
    hasSkillsDir: fs.existsSync(path.join(cwd, 'skills')),
    hasToolsDir: fs.existsSync(path.join(cwd, 'src', 'tools')) || fs.existsSync(path.join(cwd, 'tools')),
    hasElectronFiles: fs.existsSync(path.join(cwd, 'electron')) || fs.existsSync(path.join(cwd, 'electron-main.js')),
    hasPythonFiles: hasFileMatching(cwd, file => file.endsWith('.py')),
    hasRobotFiles: fs.existsSync(path.join(cwd, 'package.xml'))
      || fs.existsSync(path.join(cwd, 'launch'))
      || fs.existsSync(path.join(cwd, 'msg'))
      || fs.existsSync(path.join(cwd, 'srv'))
      || fs.existsSync(path.join(cwd, 'action')),
    hasDataPipelineFiles: topLevelFiles.some(name => ['dvc.yaml', 'airflow.cfg', 'dagster.yaml'].includes(name))
      || fs.existsSync(path.join(cwd, 'dags')),
    topLevelFiles,
  };
}

function detectProjectTypes(signals: ProjectSignals): ProjectType[] {
  const detected: ProjectType[] = [];
  const deps = Object.keys(signals.dependencies).map(name => name.toLowerCase());
  const scripts = signals.packageScripts;

  if (signals.hasRolesDir || signals.hasSkillsDir || signals.hasToolsDir) detected.push('agent-runtime');
  if (signals.hasRobotFiles || deps.some(name => /ros|rclnodejs|rclpy/.test(name))) detected.push('robot');
  if (signals.hasElectronFiles || deps.some(name => ['electron', '@electron/remote'].includes(name))) detected.push('desktop');
  if (deps.some(name => ['express', 'fastify', 'koa', '@nestjs/core', 'hono'].includes(name))
    || signals.topLevelFiles.some(name => /server\.(ts|js|mjs|cjs)$/.test(name))) detected.push('api');
  if (signals.hasIndexHtml
    || deps.some(name => ['vite', 'next', 'react', 'vue', 'svelte', 'astro', '@angular/core'].includes(name))
    || Boolean(scripts.dev && /vite|next|astro|webpack|parcel/.test(String(scripts.dev)))) detected.push('web');
  if (signals.packageJson?.bin || deps.some(name => ['commander', 'yargs', 'cac', 'clipanion'].includes(name))) detected.push('cli');
  if (signals.hasDataPipelineFiles) detected.push('data-pipeline');
  if (detected.length === 0 && signals.packageJson) detected.push('library');
  if (detected.length === 0 && signals.hasPythonFiles) detected.push('library');

  return Array.from(new Set(detected));
}

function inferEntryPoints(cwd: string, signals: ProjectSignals, types: ProjectType[]): EvalEntryPoint[] {
  const entries: EvalEntryPoint[] = [];
  const scripts = signals.packageScripts;

  if (signals.packageJson?.bin) {
    const binEntries = typeof signals.packageJson.bin === 'string'
      ? [[signals.packageJson.name || 'cli', signals.packageJson.bin]]
      : Object.entries(signals.packageJson.bin);
    for (const [name, target] of binEntries) {
      entries.push({ id: `cli-${safeSegment(String(name))}`, type: 'cli', target: String(target), description: 'Package bin command' });
    }
  }
  for (const name of ['dev', 'start', 'build', 'test']) {
    if (scripts[name]) {
      entries.push({ id: `npm-${name}`, type: 'npm-script', target: `npm run ${name}`, description: `package.json script: ${name}` });
    }
  }
  if (types.includes('web') && signals.hasIndexHtml) {
    entries.push({ id: 'web-index', type: 'web', target: path.relative(cwd, findFirstExisting(cwd, ['index.html', 'public/index.html']) || path.join(cwd, 'index.html')), description: 'Static or app shell HTML entry' });
  }
  if (types.includes('api')) {
    entries.push({ id: 'api-server', type: 'api', target: scripts.start ? 'npm run start' : 'server entry', description: 'HTTP service entrypoint inferred from dependencies/files' });
  }
  if (types.includes('desktop')) {
    entries.push({ id: 'desktop-launch', type: 'desktop', target: scripts['electron:dev'] ? 'npm run electron:dev' : 'desktop app launch', description: 'Desktop/Electron launch path' });
  }
  if (types.includes('agent-runtime')) {
    entries.push({ id: 'agent-role-skill', type: 'agent-runtime', target: 'role/skill/tool activation', description: 'Agent role, skill, and tool runtime entrypoint' });
  }
  if (types.includes('robot')) {
    entries.push({ id: 'robot-control', type: 'robot', target: 'service/topic/action/stream boundary', description: 'Robotics control or stream boundary' });
  }

  return dedupeById(entries);
}

function inferCriticalUserPaths(projectType: ProjectType, types: ProjectType[], entryPoints: EvalEntryPoint[]): CriticalUserPath[] {
  const paths: CriticalUserPath[] = [];
  if (types.includes('web')) {
    paths.push({
      id: 'WEB-HAPPY-PATH',
      user: 'end user',
      preconditions: ['app can be opened in a browser', 'required env and backend dependencies are available or mocked'],
      steps: ['open primary page', 'verify main content is visible', 'perform the core interaction changed by this review'],
      expectedOutcome: 'visible UI state confirms the user task completed',
      evidence: ['screenshot', 'console/network error summary', 'interaction result'],
    });
  }
  if (types.includes('cli')) {
    paths.push({
      id: 'CLI-HAPPY-PATH',
      user: 'developer/operator',
      preconditions: ['package is built or executable command is available'],
      steps: ['run help command', 'run one valid happy-path command', 'run one invalid input command'],
      expectedOutcome: 'exit codes, stdout, and stderr match the CLI contract',
      evidence: ['command transcript', 'exit code', 'generated artifacts if any'],
    });
  }
  if (types.includes('api')) {
    paths.push({
      id: 'API-HAPPY-PATH',
      user: 'API client',
      preconditions: ['service can start on a test port', 'required storage/auth dependencies are configured or mocked'],
      steps: ['start service briefly', 'call health endpoint', 'call core endpoint', 'send invalid payload'],
      expectedOutcome: 'status codes and response bodies match the API contract',
      evidence: ['server log', 'HTTP responses', 'exit/cleanup status'],
    });
  }
  if (types.includes('agent-runtime')) {
    paths.push({
      id: 'AGENT-RUNTIME-PATH',
      user: 'IM/CLI user',
      preconditions: ['role and skills can load', 'tool permissions are known'],
      steps: ['activate role', 'trigger relevant skill/tool', 'inspect artifact or state transition'],
      expectedOutcome: 'agent behavior matches the role contract and produces traceable artifacts',
      evidence: ['tool transcript', 'artifact paths', 'state transition'],
    });
  }
  if (types.includes('desktop')) {
    paths.push({
      id: 'DESKTOP-SMOKE-PATH',
      user: 'desktop user',
      preconditions: ['desktop runtime can launch in test/smoke mode'],
      steps: ['launch app briefly', 'verify window or main UI exists', 'close cleanly'],
      expectedOutcome: 'app launches without blocking the reviewer process',
      evidence: ['launch log', 'screenshot if available', 'exit/cleanup status'],
    });
  }
  if (types.includes('robot')) {
    paths.push({
      id: 'ROBOT-MVP-PATH',
      user: 'robot operator',
      preconditions: ['simulator/mock/device availability is declared'],
      steps: ['identify service/topic/action/stream type', 'run dry-run or mock command', 'verify response or state'],
      expectedOutcome: 'shortest safe control path is verified or blocked with missing hardware reason',
      evidence: ['command log', 'service/topic/action response', 'stream metadata'],
    });
  }
  if (paths.length === 0) {
    paths.push({
      id: `${projectType.toUpperCase()}-BASIC-PATH`,
      user: 'project user',
      preconditions: ['project entrypoint and required environment are identified'],
      steps: ['run the lowest-risk smoke check', 'verify observable output'],
      expectedOutcome: 'project entrypoint produces a verifiable result',
      evidence: ['command output', 'artifact path'],
    });
  }
  if (entryPoints.length === 0) {
    paths[0].preconditions.push('primary entrypoint is not yet identified');
  }
  return paths;
}

function createReviewEvalPlan(input: {
  reviewId: string;
  cwd: string;
  request: string;
  changedFiles: string[];
  implementationSummary: string;
  profile: ProjectEvalProfile;
}): ReviewEvalPlan {
  const { profile } = input;
  const requiredChecks = inferRequiredChecks(profile);
  const optionalChecks = inferOptionalChecks(profile);
  const blockedChecks = inferBlockedChecks(profile);
  const reviewLenses = inferReviewLenses(profile);

  return {
    version: 1,
    reviewId: input.reviewId,
    generatedAt: new Date().toISOString(),
    cwd: input.cwd,
    profileSource: profile.source,
    profilePath: profile.sourcePath,
    changeUnderReview: {
      request: input.request,
      changedFiles: input.changedFiles,
      implementationSummary: input.implementationSummary || 'No implementation summary provided.',
    },
    applicableProjectEvalRules: [
      `projectType=${profile.projectType}`,
      `detected=${profile.detectedProjectTypes.join(',') || 'unknown'}`,
      ...profile.criticalInvariants,
    ],
    acceptanceCriteria: [
      {
        criterion: 'The original request is covered by observable behavior, not only by code changes.',
        evidenceRequired: ['test matrix evidence', 'actual output/log/screenshot/artifact'],
        severityIfFailed: 'high',
      },
      {
        criterion: 'At least one primary entrypoint is smoke-tested or explicitly blocked.',
        evidenceRequired: ['entrypoint command/action evidence', 'blocked reason if unavailable'],
        severityIfFailed: 'high',
      },
      {
        criterion: 'Low-level tests are labeled by evidence strength and not misrepresented as E2E.',
        evidenceRequired: ['evidence level per check', 'missing evidence list'],
        severityIfFailed: 'medium',
      },
    ],
    reviewLenses,
    requiredChecks,
    optionalChecks,
    blockedChecks,
    closureThreshold: profile.evidenceThresholds.closed,
    reopenThreshold: [
      'core user path fails',
      'required entrypoint cannot be verified and no explicit closure exception exists',
      'implementation changes unauthorized regression surface',
      'coding agent output cannot be tied to files, tests, or artifacts',
    ],
    manualReviewThreshold: [
      'requires real account/API key/device/production-like external service',
      'test could mutate production data or incur cost',
      'business acceptance cannot be inferred from repo evidence',
    ],
  };
}

function inferReviewLenses(profile: ProjectEvalProfile): ReviewLens[] {
  const lenses: ReviewLens[] = [
    {
      id: 'LENS-TEST-ENGINEER',
      source: 'test-engineer',
      focus: 'Coverage gaps, behavior boundaries, error paths, and concurrency risks.',
      questions: [
        'Do tests cover happy path, empty input, boundary values, error paths, and repeated/parallel operations where relevant?',
        'Are tests checking observable behavior instead of private implementation details?',
        'For bug fixes, is there a regression/prove-it test or a clear reason it is blocked?',
      ],
      requiredEvidence: ['test matrix rows by evidence level', 'targeted test output or blocked reason', 'coverage gaps list'],
      closureImpact: 'blocks_if_failed',
    },
    {
      id: 'LENS-CODE-QUALITY',
      source: 'code-quality',
      focus: 'Correctness, readability, architecture fit, performance, and maintainability.',
      questions: [
        'Does the change match the request and existing project conventions?',
        'Are module boundaries preserved and abstractions earning their complexity?',
        'Are unbounded operations, race conditions, or performance regressions introduced?',
      ],
      requiredEvidence: ['diff review summary', 'file/line findings when present', 'verification story'],
      closureImpact: 'blocks_if_failed',
    },
    {
      id: 'LENS-SECURITY',
      source: 'security',
      focus: 'Input boundaries, secrets, authorization, command/file/network safety, and dependency risk.',
      questions: [
        'Is external input validated at the boundary before it reaches commands, files, HTML, SQL, or network calls?',
        'Are secrets excluded from code, logs, artifacts, and user-visible outputs?',
        'Does the change add dependencies, permissions, or data flows that need review?',
      ],
      requiredEvidence: ['security-sensitive files reviewed or marked not applicable', 'dependency/secret check where applicable'],
      closureImpact: 'blocks_if_failed',
    },
    {
      id: 'LENS-DEBUGGING-RECOVERY',
      source: 'debugging',
      focus: 'Stop-the-line failure handling: reproduce, localize, reduce, fix root cause, guard, verify.',
      questions: [
        'If any check failed, was the failure preserved with command/log evidence?',
        'Was the root cause addressed rather than only the symptom?',
        'Was a recurrence guard added or explicitly marked blocked?',
      ],
      requiredEvidence: ['failure transcript when present', 'root cause note', 're-run validation result'],
      closureImpact: 'raises_risk',
    },
  ];

  if (profile.detectedProjectTypes.includes('web')) {
    lenses.push({
      id: 'LENS-BROWSER-RUNTIME',
      source: 'runtime-e2e',
      focus: 'Real browser visibility, DOM/console/network evidence, screenshots, and accessibility basics.',
      questions: [
        'Was the changed user path observed in a browser or explicitly blocked by missing prerequisites?',
        'Were console errors, failed network requests, and responsive/mobile-visible layout risks checked?',
        'Is browser content treated as untrusted observation data, not agent instructions?',
      ],
      requiredEvidence: ['browser screenshot or blocked reason', 'console/network summary', 'viewport notes when UI changed'],
      closureImpact: 'blocks_if_failed',
    });
  }

  if (profile.detectedProjectTypes.includes('agent-runtime')) {
    lenses.push({
      id: 'LENS-AGENT-RUNTIME-E2E',
      source: 'runtime-e2e',
      focus: 'Agent user path, tool/skill activation, subagent lifecycle, trace, and artifact observability.',
      questions: [
        'Can a user-like message reach the target role/skill/tool path?',
        'Are long task status, stop, resume, and artifact traces observable when relevant?',
        'Does the trace prove the agent did the work instead of only describing it?',
      ],
      requiredEvidence: ['session/tool transcript', 'artifact paths', 'state transition or blocked reason'],
      closureImpact: 'blocks_if_failed',
    });
  }

  return lenses;
}

function inferRequiredChecks(profile: ProjectEvalProfile): ReviewCheck[] {
  const checks: ReviewCheck[] = [];
  const types = profile.detectedProjectTypes;

  if (types.includes('web')) {
    checks.push({
      id: 'WEB-SMOKE',
      level: 'smoke',
      description: 'Open the primary web entrypoint and verify visible content.',
      action: 'Use browser or static file smoke check against primary page.',
      expected: 'main content renders without fatal console errors',
      evidence: ['screenshot', 'console summary'],
      automatable: true,
      riskIfSkipped: 'Page may build but be unusable for real users.',
    });
    checks.push({
      id: 'WEB-E2E-HAPPY-PATH',
      level: 'e2e',
      description: 'Exercise the core interaction changed by this review.',
      action: 'Use Playwright/browser interaction or document blocked prerequisites.',
      expected: 'observable UI state confirms the user task completed',
      evidence: ['interaction steps', 'screenshot/result text'],
      automatable: true,
      riskIfSkipped: 'Static/build checks could pass while the user path is broken.',
    });
  }

  if (types.includes('cli')) {
    const cliEntry = profile.entryPoints.find(entry => entry.type === 'cli');
    checks.push({
      id: 'CLI-HELP',
      level: 'smoke',
      description: 'Run CLI help or equivalent lowest-risk command.',
      command: cliEntry ? `${cliEntry.id.replace(/^cli-/, '')} --help` : '<cli> --help',
      expected: 'exit 0 and readable usage output',
      evidence: ['exit code', 'stdout/stderr'],
      automatable: true,
      riskIfSkipped: 'CLI may be installed but unusable from a fresh shell.',
    });
    checks.push({
      id: 'CLI-BAD-INPUT',
      level: 'e2e_boundary',
      description: 'Run one invalid input path and verify friendly failure.',
      action: 'Choose a non-destructive invalid argument for the target CLI.',
      expected: 'non-zero or handled error with actionable stderr',
      evidence: ['exit code', 'stderr'],
      automatable: true,
      riskIfSkipped: 'Users may hit confusing or unsafe failure modes.',
    });
  }

  if (types.includes('api')) {
    checks.push({
      id: 'API-HEALTH',
      level: 'smoke',
      description: 'Start service briefly and call a health or root endpoint.',
      action: 'Short-lived server + HTTP request on test port.',
      expected: 'service responds and can be stopped cleanly',
      evidence: ['server log', 'HTTP status/body'],
      automatable: true,
      riskIfSkipped: 'Handlers may typecheck but service may not boot.',
    });
  }

  if (types.includes('agent-runtime')) {
    checks.push({
      id: 'AGENT-ROLE-SKILL-LOAD',
      level: 'integration',
      description: 'Verify roles, skills, and role-specific tools can load.',
      command: 'npx tsx --test tests/roles.test.ts tests/tool-manager-roles.test.ts',
      expected: 'role and tool registration tests pass',
      evidence: ['test output'],
      automatable: true,
      riskIfSkipped: 'Prompt/skill changes may be present but unreachable at runtime.',
    });
    checks.push({
      id: 'AGENT-USER-PATH',
      level: 'e2e',
      description: 'Exercise the relevant agent user path or mark the missing runtime surface.',
      action: 'Use chat/session/tool transcript or a focused integration harness.',
      expected: 'agent state transition and artifact match the role contract',
      evidence: ['session id', 'tool transcript', 'artifact path'],
      automatable: false,
      riskIfSkipped: 'Unit tests may miss user-facing runtime orchestration failures.',
    });
  }

  if (checks.length === 0) {
    checks.push({
      id: 'GENERIC-SMOKE',
      level: 'smoke',
      description: 'Run the lowest-risk entrypoint smoke check after identifying the project type.',
      action: 'Inspect repo and execute a non-destructive smoke check.',
      expected: 'primary entrypoint produces observable output',
      evidence: ['command output or artifact'],
      automatable: false,
      riskIfSkipped: 'No evidence that the project can be used from its real entrypoint.',
    });
  }

  return dedupeChecks(checks);
}

function inferOptionalChecks(profile: ProjectEvalProfile): ReviewCheck[] {
  const checks: ReviewCheck[] = [];
  if (profile.entryPoints.some(entry => entry.target === 'npm run build')) {
    checks.push({
      id: 'NODE-BUILD',
      level: 'static',
      description: 'Run package build script.',
      command: 'npm run build',
      expected: 'build exits 0',
      evidence: ['stdout/stderr'],
      automatable: true,
      riskIfSkipped: 'Type/bundling errors may slip through.',
    });
  }
  if (profile.entryPoints.some(entry => entry.target === 'npm run test')) {
    checks.push({
      id: 'NODE-TEST',
      level: 'unit',
      description: 'Run package test script and label it as low-level evidence.',
      command: 'npm test',
      expected: 'tests exit 0',
      evidence: ['test output'],
      automatable: true,
      riskIfSkipped: 'Local contracts may regress.',
    });
  }
  return dedupeChecks(checks);
}

function inferBlockedChecks(profile: ProjectEvalProfile): ReviewEvalPlan['blockedChecks'] {
  const blocked: ReviewEvalPlan['blockedChecks'] = [];
  for (const prerequisite of profile.environmentPrerequisites.required) {
    if (/api key|account|device|database|robot|external/i.test(prerequisite)) {
      blocked.push({
        check: `Verify prerequisite: ${prerequisite}`,
        missingPrerequisite: prerequisite,
        riskIfSkipped: 'Reviewer cannot prove the real user path in a production-like environment.',
      });
    }
  }
  return blocked;
}

function createTestMatrix(profile: ProjectEvalProfile, plan: ReviewEvalPlan): TestMatrixItem[] {
  const planned = [...plan.requiredChecks, ...plan.optionalChecks].map(check => ({
    id: check.id,
    userPathOrSystemPath: check.description,
    level: check.level,
    preconditions: profile.environmentPrerequisites.required,
    steps: check.command ? [`run \`${check.command}\``] : [check.action || check.description],
    expectedResult: check.expected,
    evidenceSource: check.evidence,
    automatable: check.automatable,
    status: 'planned' as const,
    riskIfSkipped: check.riskIfSkipped,
  }));
  const blocked = plan.blockedChecks.map((check, index) => ({
    id: `BLOCKED-${index + 1}`,
    userPathOrSystemPath: check.check,
    level: 'e2e' as EvidenceLevel,
    preconditions: [check.missingPrerequisite],
    steps: ['cannot execute until prerequisite is provided'],
    expectedResult: 'blocked reason is explicit and risk is recorded',
    evidenceSource: ['blocked reason'],
    automatable: false,
    status: 'blocked' as const,
    riskIfSkipped: check.riskIfSkipped,
  }));
  return [...planned, ...blocked];
}

function normalizeExistingProfile(raw: any, inferred: ProjectEvalProfile, sourcePath: string): ProjectEvalProfile {
  return {
    ...inferred,
    ...raw,
    version: 1,
    source: 'existing',
    sourcePath,
    sourceMarkdown: typeof raw.sourceMarkdown === 'string' ? truncate(raw.sourceMarkdown, 12000) : inferred.sourceMarkdown,
    generatedAt: String(raw.generatedAt || inferred.generatedAt),
    projectRoot: String(raw.projectRoot || inferred.projectRoot),
    projectType: normalizeProjectType(raw.projectType, inferred.projectType),
    detectedProjectTypes: normalizeProjectTypes(raw.detectedProjectTypes, inferred.detectedProjectTypes),
    primaryUsers: normalizeStringArray(raw.primaryUsers, inferred.primaryUsers),
    entryPoints: Array.isArray(raw.entryPoints) && raw.entryPoints.length > 0 ? raw.entryPoints : inferred.entryPoints,
    criticalUserPaths: Array.isArray(raw.criticalUserPaths) && raw.criticalUserPaths.length > 0 ? raw.criticalUserPaths : inferred.criticalUserPaths,
    criticalInvariants: normalizeStringArray(raw.criticalInvariants, inferred.criticalInvariants),
    environmentPrerequisites: {
      required: normalizeStringArray(raw.environmentPrerequisites?.required, inferred.environmentPrerequisites.required),
      optional: normalizeStringArray(raw.environmentPrerequisites?.optional, inferred.environmentPrerequisites.optional),
      dangerous: normalizeStringArray(raw.environmentPrerequisites?.dangerous, inferred.environmentPrerequisites.dangerous),
    },
    evidenceThresholds: {
      smoke: normalizeStringArray(raw.evidenceThresholds?.smoke, inferred.evidenceThresholds.smoke),
      e2e: normalizeStringArray(raw.evidenceThresholds?.e2e, inferred.evidenceThresholds.e2e),
      closed: normalizeStringArray(raw.evidenceThresholds?.closed, inferred.evidenceThresholds.closed),
    },
    regressionSurface: normalizeStringArray(raw.regressionSurface, inferred.regressionSurface),
    nonAutomatableChecks: Array.isArray(raw.nonAutomatableChecks) ? raw.nonAutomatableChecks : inferred.nonAutomatableChecks,
    projectBoundaries: {
      allowedScope: normalizeStringArray(raw.projectBoundaries?.allowedScope, inferred.projectBoundaries.allowedScope),
      disallowedScope: normalizeStringArray(raw.projectBoundaries?.disallowedScope, inferred.projectBoundaries.disallowedScope),
    },
  };
}

function inferPrimaryUsers(projectType: ProjectType, types: ProjectType[]): string[] {
  const users = new Set<string>();
  if (types.includes('web')) users.add('end user');
  if (types.includes('cli')) users.add('developer/operator');
  if (types.includes('api')) users.add('API client');
  if (types.includes('agent-runtime')) users.add('IM/CLI user');
  if (types.includes('desktop')) users.add('desktop user');
  if (types.includes('robot')) users.add('robot operator');
  if (users.size === 0) users.add(projectType === 'library' ? 'developer' : 'project user');
  return Array.from(users);
}

function inferCriticalInvariants(_projectType: ProjectType, types: ProjectType[]): string[] {
  const invariants = ['Do not claim E2E passed without real entrypoint evidence.'];
  if (types.includes('agent-runtime')) invariants.push('Role, skill, and tool changes must be reachable through runtime activation.');
  if (types.includes('web')) invariants.push('Primary page must render visible content and complete the core interaction without fatal console errors.');
  if (types.includes('cli')) invariants.push('CLI must provide readable help, correct exit codes, and safe bad-input handling.');
  if (types.includes('api')) invariants.push('Service must start on a test port, respond to health/core requests, and clean up.');
  if (types.includes('robot')) invariants.push('Robot control tests must distinguish service/topic/action/stream boundaries and avoid unsafe hardware actions.');
  return invariants;
}

function inferEnvironmentPrerequisites(_projectType: ProjectType, types: ProjectType[]): ProjectEvalProfile['environmentPrerequisites'] {
  const required = ['repository checkout', 'runtime dependencies installed'];
  const optional: string[] = [];
  const dangerous = ['production data mutation', 'paid external API calls without explicit approval'];

  if (types.includes('web')) optional.push('browser runtime for E2E');
  if (types.includes('api')) required.push('test port availability'); optional.push('database/cache/API keys if endpoints require them');
  if (types.includes('desktop')) optional.push('headless desktop/display support');
  if (types.includes('robot')) required.push('simulator/mock or physical device availability declaration'); dangerous.push('unsafe physical robot motion');
  if (types.includes('agent-runtime')) optional.push('provider credentials for model-backed E2E');

  return { required, optional, dangerous };
}

function inferEvidenceThresholds(_projectType: ProjectType, types: ProjectType[]): ProjectEvalProfile['evidenceThresholds'] {
  const smoke = ['primary entrypoint identified', 'lowest-risk entrypoint check executed or explicitly blocked'];
  const e2e = ['critical user path steps executed through real entrypoint', 'observable result captured'];
  const closed = [
    'original request acceptance criteria mapped to evidence',
    'no required E2E check failed',
    'missing evidence is explicitly listed and acceptable for closure',
  ];
  if (types.includes('agent-runtime')) closed.push('role/skill/tool activation is verified or explicitly blocked');
  if (types.includes('web')) closed.push('browser-visible result or blocked browser prerequisite is recorded');
  return { smoke, e2e, closed };
}

function inferRegressionSurface(signals: ProjectSignals, types: ProjectType[]): string[] {
  const surface = ['changed files', 'public entrypoints', 'configuration and environment variables'];
  if (signals.packageJson) surface.push('package scripts and bin commands');
  if (types.includes('agent-runtime')) surface.push('roles, skills, tools, session state, subagent lifecycle');
  if (types.includes('web')) surface.push('primary routes, static assets, browser interactions');
  if (types.includes('api')) surface.push('routes, auth, request/response schemas');
  if (types.includes('robot')) surface.push('service/topic/action/stream contracts');
  return surface;
}

function inferNonAutomatableChecks(types: ProjectType[]): ProjectEvalProfile['nonAutomatableChecks'] {
  const checks: ProjectEvalProfile['nonAutomatableChecks'] = [];
  if (types.includes('robot')) {
    checks.push({ check: 'physical device safety behavior', reason: 'requires hardware/simulator and safety constraints', humanOwner: 'robot operator' });
  }
  if (types.includes('api')) {
    checks.push({ check: 'real third-party account behavior', reason: 'requires credentials and may incur cost', humanOwner: 'service owner' });
  }
  return checks;
}

export function renderProjectEvalProfileMarkdown(profile: ProjectEvalProfile): string {
  return [
    '# Project Eval Profile',
    '',
    `Generated: ${profile.generatedAt}`,
    `Source: ${profile.source}${profile.sourcePath ? ` (${profile.sourcePath})` : ''}`,
    `Project root: ${profile.projectRoot}`,
    `Project type: ${profile.projectType}`,
    `Detected types: ${profile.detectedProjectTypes.join(', ') || 'unknown'}`,
    '',
    profile.sourceMarkdown ? [
      '## Existing Profile Markdown',
      '',
      profile.sourceMarkdown,
      '',
      '## Inferred / Normalized Profile',
      '',
    ].join('\n') : '',
    '## Primary Users',
    bullet(profile.primaryUsers),
    '',
    '## Primary Entry Points',
    bullet(profile.entryPoints.map(entry => `${entry.id}: [${entry.type}] ${entry.target} - ${entry.description}`)),
    '',
    '## Critical User Paths',
    profile.criticalUserPaths.map(pathItem => [
      `### ${pathItem.id}`,
      `User: ${pathItem.user}`,
      '',
      'Preconditions:',
      bullet(pathItem.preconditions),
      '',
      'Steps:',
      numbered(pathItem.steps),
      '',
      `Expected: ${pathItem.expectedOutcome}`,
      '',
      'Evidence:',
      bullet(pathItem.evidence),
    ].join('\n')).join('\n\n'),
    '',
    '## Critical Invariants',
    bullet(profile.criticalInvariants),
    '',
    '## Environment Prerequisites',
    'Required:',
    bullet(profile.environmentPrerequisites.required),
    '',
    'Optional:',
    bullet(profile.environmentPrerequisites.optional),
    '',
    'Dangerous:',
    bullet(profile.environmentPrerequisites.dangerous),
    '',
    '## Evidence Thresholds',
    'Smoke:',
    bullet(profile.evidenceThresholds.smoke),
    '',
    'E2E:',
    bullet(profile.evidenceThresholds.e2e),
    '',
    'Closed:',
    bullet(profile.evidenceThresholds.closed),
    '',
    '## Regression Surface',
    bullet(profile.regressionSurface),
    '',
    '## Known Non-Automatable Checks',
    bullet(profile.nonAutomatableChecks.map(check => `${check.check}: ${check.reason} (owner: ${check.humanOwner})`)),
    '',
    '## Project-Specific Boundaries',
    'Allowed scope:',
    bullet(profile.projectBoundaries.allowedScope),
    '',
    'Disallowed scope:',
    bullet(profile.projectBoundaries.disallowedScope),
    '',
  ].join('\n');
}

export function renderReviewEvalPlanMarkdown(plan: ReviewEvalPlan): string {
  return [
    '# Review Eval Plan',
    '',
    `Review ID: ${plan.reviewId}`,
    `Generated: ${plan.generatedAt}`,
    `CWD: ${plan.cwd}`,
    `Profile source: ${plan.profileSource}${plan.profilePath ? ` (${plan.profilePath})` : ''}`,
    '',
    '## Change Under Review',
    `Request: ${plan.changeUnderReview.request}`,
    `Implementation summary: ${plan.changeUnderReview.implementationSummary}`,
    '',
    'Changed files:',
    bullet(plan.changeUnderReview.changedFiles),
    '',
    '## Applicable Project Eval Rules',
    bullet(plan.applicableProjectEvalRules),
    '',
    '## Acceptance Criteria',
    bullet(plan.acceptanceCriteria.map(item => `${item.criterion} [severity=${item.severityIfFailed}; evidence=${item.evidenceRequired.join(', ')}]`)),
    '',
    '## Review Lenses',
    renderReviewLenses(plan.reviewLenses),
    '',
    '## Required Checks',
    renderChecks(plan.requiredChecks),
    '',
    '## Optional Checks',
    renderChecks(plan.optionalChecks),
    '',
    '## Blocked Checks',
    bullet(plan.blockedChecks.map(item => `${item.check}: missing=${item.missingPrerequisite}; risk=${item.riskIfSkipped}`)),
    '',
    '## Closure Threshold',
    bullet(plan.closureThreshold),
    '',
    '## Reopen Threshold',
    bullet(plan.reopenThreshold),
    '',
    '## Manual Review Threshold',
    bullet(plan.manualReviewThreshold),
    '',
  ].join('\n');
}

export function renderBoundaryMapMarkdown(profile: ProjectEvalProfile): string {
  return [
    '# Boundary Map',
    '',
    `Project type: ${profile.projectType}`,
    `Detected types: ${profile.detectedProjectTypes.join(', ') || 'unknown'}`,
    '',
    '## Entry Points',
    bullet(profile.entryPoints.map(entry => `${entry.id}: ${entry.target}`)),
    '',
    '## Preconditions',
    bullet(profile.environmentPrerequisites.required),
    '',
    '## Success Signals',
    bullet(profile.criticalUserPaths.flatMap(pathItem => pathItem.evidence)),
    '',
    '## Failure Signals',
    bullet(['non-zero exit/status code', 'fatal console/runtime error', 'missing expected artifact', 'timeout/no response', 'blocked prerequisite']),
    '',
    '## Regression Surface',
    bullet(profile.regressionSurface),
    '',
  ].join('\n');
}

export function renderTestMatrixMarkdown(items: TestMatrixItem[]): string {
  const lines = ['# Test Matrix', ''];
  for (const item of items) {
    lines.push(`## ${item.id}`);
    lines.push(`Level: ${item.level}`);
    lines.push(`Status: ${item.status}`);
    lines.push(`Automatable: ${item.automatable ? 'yes' : 'no'}`);
    lines.push(`Path: ${item.userPathOrSystemPath}`);
    lines.push('');
    lines.push('Preconditions:');
    lines.push(bullet(item.preconditions));
    lines.push('');
    lines.push('Steps:');
    lines.push(numbered(item.steps));
    lines.push('');
    lines.push(`Expected: ${item.expectedResult}`);
    lines.push('');
    lines.push('Evidence:');
    lines.push(bullet(item.evidenceSource));
    lines.push('');
    lines.push(`Risk if skipped: ${item.riskIfSkipped}`);
    lines.push('');
  }
  return lines.join('\n');
}

function renderChecks(checks: ReviewCheck[]): string {
  if (checks.length === 0) return '- none';
  return checks.map(check => [
    `- ${check.id} [${check.level}]`,
    `  description: ${check.description}`,
    check.command ? `  command: ${check.command}` : `  action: ${check.action || 'n/a'}`,
    `  expected: ${check.expected}`,
    `  evidence: ${check.evidence.join(', ')}`,
    `  automatable: ${check.automatable ? 'yes' : 'no'}`,
    `  riskIfSkipped: ${check.riskIfSkipped}`,
  ].filter(Boolean).join('\n')).join('\n');
}

function renderReviewLenses(lenses: ReviewLens[]): string {
  if (lenses.length === 0) return '- none';
  return lenses.map(lens => [
    `- ${lens.id} [${lens.source}; ${lens.closureImpact}]`,
    `  focus: ${lens.focus}`,
    `  questions: ${lens.questions.join(' | ')}`,
    `  evidence: ${lens.requiredEvidence.join(', ')}`,
  ].join('\n')).join('\n');
}

function readJson(filePath: string): any | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return undefined;
  }
}

function listTopLevelFiles(cwd: string): string[] {
  try {
    return fs.readdirSync(cwd).sort();
  } catch {
    return [];
  }
}

function hasFileMatching(cwd: string, predicate: (fileName: string) => boolean): boolean {
  try {
    return fs.readdirSync(cwd).some(name => predicate(name));
  } catch {
    return false;
  }
}

function findFirstExisting(cwd: string, candidates: string[]): string | undefined {
  return candidates.map(candidate => path.join(cwd, candidate)).find(candidate => fs.existsSync(candidate));
}

function normalizeProjectType(value: unknown, fallback: ProjectType): ProjectType {
  const text = String(value || '').trim();
  return isProjectType(text) ? text : fallback;
}

function normalizeProjectTypes(value: unknown, fallback: ProjectType[]): ProjectType[] {
  if (!Array.isArray(value)) return fallback;
  const normalized = value.map(item => String(item)).filter(isProjectType) as ProjectType[];
  return normalized.length > 0 ? normalized : fallback;
}

function isProjectType(value: string): value is ProjectType {
  return ['web', 'cli', 'api', 'desktop', 'agent-runtime', 'robot', 'library', 'data-pipeline', 'mixed', 'unknown'].includes(value);
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const result = value.map(item => String(item).trim()).filter(Boolean);
  return result.length > 0 ? result : fallback;
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function dedupeChecks(items: ReviewCheck[]): ReviewCheck[] {
  return dedupeById(items);
}

function mapRelativePaths(paths: ReviewEvalPreparationResult['paths'], cwd: string): Record<string, string> {
  return Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, path.relative(cwd, value).replace(/\\/g, '/')]));
}

function bullet(items: string[]): string {
  return items.length > 0 ? items.map(item => `- ${item}`).join('\n') : '- none';
}

function numbered(items: string[]): string {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item}`).join('\n') : '1. none';
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 3) return value.slice(0, maxChars);
  return `${value.slice(0, maxChars - 3)}...`;
}

function createReviewId(): string {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  return `review-${stamp}-${randomUUID().slice(0, 8)}`;
}

function safeSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'review';
}
