import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ArtifactManifestItem, Tool, ToolDefinition, ToolExecutionContext } from '../../../types/tool';

const execAsync = promisify(exec);

const TEST_ROOT = path.join('data', 'reviewer-module-tests');
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_CHARS = 2800;
const MAX_BUFFER = 10 * 1024 * 1024;

type ModuleKind = 'auto' | 'node' | 'python' | 'static' | 'custom';
type TestStatus = 'passed' | 'failed' | 'timeout';

interface TestSpec {
  name: string;
  command: string;
  cwd?: string;
  timeoutMs: number;
}

interface TestResult {
  name: string;
  command: string;
  cwd: string;
  status: TestStatus;
  exitCode: number | string | null;
  durationMs: number;
  stdoutFile: string;
  stderrFile: string;
  stdoutTail: string;
  stderrTail: string;
}

export class ReviewerModuleTestTool implements Tool {
  definition: ToolDefinition = {
    name: 'reviewer_module_test',
    description: [
      '历史/辅助入口：运行低层模块检查并生成可供 ReviewerCat 读取的辅助证据。',
      '默认只返回低 token 的通过/失败摘要；完整 stdout/stderr 会写入 data/reviewer-module-test/<run_id>/。',
      '它不是 ReviewerCat 默认端测步骤；失败时把摘要作为前置风险交给 EngineerCat / Codex。'
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description: '测试工作目录，默认当前工具工作目录。'
        },
        module: {
          type: 'string',
          enum: ['auto', 'node', 'python', 'static', 'custom'],
          description: '模块类型。auto 会根据 package.json / Python 文件 / 静态前端文件推断测试命令。默认 auto。'
        },
        run_id: {
          type: 'string',
          description: '可选测试 run id；不填自动生成。'
        },
        tests: {
          type: 'array',
          description: '自定义低层检查列表。传了 tests 时 module 推断不会生效。',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: '测试名称。'
              },
              command: {
                type: 'string',
                description: '测试命令。'
              },
              cwd: {
                type: 'string',
                description: '相对 cwd 的子目录。'
              },
              timeout_ms: {
                type: 'number',
                description: '单条测试超时，默认 120000ms。'
              }
            },
            required: ['command']
          }
        },
        max_chars: {
          type: 'number',
          description: '最大返回字符数，默认 2800。'
        }
      }
    }
  };

  async execute(args: any, context: ToolExecutionContext): Promise<string> {
    const baseCwd = resolveTestCwd(context.workingDirectory, args.cwd);
    const runId = safeSegment(String(args.run_id || createRunId()));
    const runDir = path.resolve(context.workingDirectory, TEST_ROOT, runId);
    const maxChars = readPositiveNumber(args.max_chars, DEFAULT_MAX_CHARS);
    const moduleKind = normalizeModuleKind(args.module);
    const tests = normalizeTests(args.tests, baseCwd) || inferTests(baseCwd, moduleKind);

    if (tests.length === 0) {
      return [
        'reviewer_module_test: status=blocked',
        `run_id=${runId}`,
        `cwd=${baseCwd}`,
        'reason=没有推断到可运行的模块测试；请传 tests=[{name,command,cwd,timeout_ms}]'
      ].join('\n');
    }

    fs.mkdirSync(runDir, { recursive: true });

    const startedAt = new Date().toISOString();
    const results: TestResult[] = [];
    for (const [index, test] of tests.entries()) {
      results.push(await runOneTest(test, baseCwd, runDir, index + 1));
    }
    const completedAt = new Date().toISOString();

    const failed = results.filter(result => result.status !== 'passed');
    const report = {
      version: 1,
      runId,
      module: moduleKind,
      cwd: baseCwd,
      status: failed.length === 0 ? 'passed' : 'failed',
      startedAt,
      completedAt,
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      results,
    };
    const reportPath = path.join(runDir, 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    if (args && typeof args === 'object') {
      args.__xiaoba_artifact_report_path = reportPath;
    }

    return truncate(formatCompactReport(runId, reportPath, results), maxChars);
  }

  getArtifactManifest(args: any, result: string, context: ToolExecutionContext): ArtifactManifestItem[] {
    const reportRef = keyValue(result, 'report') || String(args?.__xiaoba_artifact_report_path || '').trim();
    const artifacts = [
      artifactFromPath(reportRef, 'generated', context.workingDirectory),
      ...readReportLogArtifacts(reportRef, context.workingDirectory),
    ];
    return uniqueArtifacts(artifacts.filter((item): item is ArtifactManifestItem => Boolean(item)));
  }
}

async function runOneTest(test: TestSpec, baseCwd: string, runDir: string, index: number): Promise<TestResult> {
  const cwd = resolveTestCwd(baseCwd, test.cwd);
  const start = Date.now();
  let stdout = '';
  let stderr = '';
  let status: TestStatus = 'passed';
  let exitCode: number | string | null = 0;

  try {
    const result = await execAsync(test.command, {
      cwd,
      timeout: test.timeoutMs,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      encoding: 'utf-8',
    });
    stdout = result.stdout || '';
    stderr = result.stderr || '';
  } catch (error: any) {
    stdout = error?.stdout || '';
    stderr = error?.stderr || error?.message || '';
    status = error?.killed ? 'timeout' : 'failed';
    exitCode = error?.code ?? error?.signal ?? null;
  }

  const durationMs = Date.now() - start;
  const prefix = `${String(index).padStart(2, '0')}-${safeSegment(test.name)}`;
  const stdoutFile = path.join(runDir, `${prefix}.stdout.log`);
  const stderrFile = path.join(runDir, `${prefix}.stderr.log`);
  fs.writeFileSync(stdoutFile, stdout, 'utf-8');
  fs.writeFileSync(stderrFile, stderr, 'utf-8');

  return {
    name: test.name,
    command: test.command,
    cwd,
    status,
    exitCode,
    durationMs,
    stdoutFile,
    stderrFile,
    stdoutTail: tail(stdout, 1200),
    stderrTail: tail(stderr, 1200),
  };
}

function inferTests(cwd: string, moduleKind: ModuleKind): TestSpec[] {
  const tests: TestSpec[] = [];
  if ((moduleKind === 'auto' || moduleKind === 'static') && hasStaticFrontendFiles(cwd)) {
    if (fs.existsSync(path.join(cwd, 'index.html'))) {
      tests.push({
        name: 'static-assets',
        command: buildStaticAssetCheckCommand(),
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
    }

    for (const jsFile of listStaticJsFiles(cwd)) {
      tests.push({
        name: `js-syntax-${safeSegment(jsFile)}`,
        command: `node --check ${quoteForShell(jsFile)}`,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
    }
  }

  if ((moduleKind === 'auto' || moduleKind === 'node') && fs.existsSync(path.join(cwd, 'package.json'))) {
    const scripts = readPackageScripts(path.join(cwd, 'package.json'));
    if (scripts.build) {
      tests.push({ name: 'node-build', command: 'npm run build', timeoutMs: DEFAULT_TIMEOUT_MS });
    }
    if (scripts.test) {
      tests.push({ name: 'node-test', command: 'npm test', timeoutMs: DEFAULT_TIMEOUT_MS });
    }
  }

  if (moduleKind === 'auto' || moduleKind === 'python') {
    if (hasPythonFiles(cwd)) {
      addPythonTests(tests, cwd);
    }
    if (moduleKind === 'auto') {
      for (const moduleDir of listPythonModuleDirs(cwd)) {
        addPythonTests(tests, path.join(cwd, moduleDir), moduleDir);
      }
    }
  }

  return tests;
}

function addPythonTests(tests: TestSpec[], testCwd: string, relativeCwd?: string): void {
  const prefix = relativeCwd ? `${safeSegment(relativeCwd)}-` : '';
  tests.push({
    name: `${prefix}python-syntax`,
    cwd: relativeCwd,
    command: [
      'python -B -c',
      quoteForShell(
        "import ast,pathlib; files=[p for p in pathlib.Path('.').rglob('*.py') if not any(part in ('.venv','venv','env','__pycache__') for part in p.parts)]; [ast.parse(p.read_text(encoding='utf-8-sig'), filename=str(p)) for p in files]; print('python syntax ok:', len(files), 'files')"
      )
    ].join(' '),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });

  if (fs.existsSync(path.join(testCwd, 'jarvis_ui.py'))) {
    tests.push({
      name: `${prefix}pyqt-offscreen-smoke`,
      cwd: relativeCwd,
      command: [
        'python -B -c',
        quoteForShell(
          "import os; os.environ['QT_QPA_PLATFORM']='offscreen'; from PyQt6.QtWidgets import QApplication; from jarvis_ui import HologramBackground; app=QApplication([]); w=HologramBackground(); w.resize(240,160); w.show(); app.processEvents(); print('pyqt smoke ok')"
        )
      ].join(' '),
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  }
}

function normalizeTests(value: unknown, baseCwd: string): TestSpec[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const tests: TestSpec[] = [];
  value.forEach((raw, index) => {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const command = String(item.command || '').trim();
    if (!command) {
      return;
    }
    const test: TestSpec = {
      name: String(item.name || `test-${index + 1}`).trim(),
      command,
      timeoutMs: readPositiveNumber(item.timeout_ms, DEFAULT_TIMEOUT_MS),
    };
    if (item.cwd) {
      test.cwd = path.relative(baseCwd, resolveTestCwd(baseCwd, item.cwd));
    }
    tests.push(test);
  });
  return tests;
}

function readPackageScripts(packageJsonPath: string): Record<string, string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return parsed?.scripts && typeof parsed.scripts === 'object' ? parsed.scripts : {};
  } catch {
    return {};
  }
}

function hasPythonFiles(cwd: string): boolean {
  try {
    return fs.readdirSync(cwd).some(name => name.endsWith('.py'));
  } catch {
    return false;
  }
}

function listPythonModuleDirs(cwd: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(cwd, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter(entry => entry.isDirectory() && !shouldSkipDirectory(entry.name))
    .map(entry => entry.name)
    .filter(name => isPythonModuleDir(path.join(cwd, name)))
    .sort()
    .slice(0, 8);
}

function isPythonModuleDir(dir: string): boolean {
  if (!hasPythonFiles(dir)) {
    return false;
  }
  return [
    'requirements.txt',
    'pyproject.toml',
    'setup.py',
    'main.py',
    '__init__.py',
    'jarvis_ui.py',
  ].some(name => fs.existsSync(path.join(dir, name)));
}

function hasStaticFrontendFiles(cwd: string): boolean {
  return fs.existsSync(path.join(cwd, 'index.html')) || listStaticJsFiles(cwd).length > 0;
}

function listStaticJsFiles(cwd: string): string[] {
  return listFiles(cwd, filePath => filePath.endsWith('.js'))
    .map(filePath => path.relative(cwd, filePath))
    .sort()
    .slice(0, 20);
}

function listFiles(root: string, predicate: (filePath: string) => boolean): string[] {
  const results: string[] = [];
  walk(root);
  return results;

  function walk(current: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name)) {
          continue;
        }
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && predicate(fullPath)) {
        results.push(fullPath);
      }
    }
  }
}

function shouldSkipDirectory(name: string): boolean {
  return [
    '.git',
    '.venv',
    'venv',
    'env',
    'node_modules',
    'dist',
    'build',
    'release',
    'coverage',
    '__pycache__',
    'data',
    'logs',
  ].includes(name);
}

function buildStaticAssetCheckCommand(): string {
  const script = [
    "const fs=require('fs')",
    "const path=require('path')",
    "const html=fs.readFileSync('index.html','utf8')",
    "const refs=[...html.matchAll(/(?:src|href)=[\"']([^\"']+)[\"']/g)].map(m=>m[1].split(/[?#]/)[0]).filter(x=>x&&!/^(https?:|data:|mailto:|tel:|#|\\/)/i.test(x))",
    "const missing=refs.filter(x=>!fs.existsSync(path.resolve(x)))",
    "if(missing.length){console.error('missing assets: '+missing.join(', '));process.exit(1)}",
    "console.log('static assets ok:',refs.length,'refs')",
  ].join(';');
  return buildNodeEvalCommand(script);
}

function buildNodeEvalCommand(script: string): string {
  const encoded = Buffer.from(script, 'utf-8').toString('base64');
  return `node -e "eval(Buffer.from('${encoded}','base64').toString('utf8'))"`;
}

function formatCompactReport(runId: string, reportPath: string, results: TestResult[]): string {
  const failed = results.filter(result => result.status !== 'passed');
  const lines = [
    `reviewer_module_test: status=${failed.length === 0 ? 'passed' : 'failed'}`,
    `run_id=${runId}`,
    `passed=${results.length - failed.length}/${results.length}`,
    `report=${relativeDisplayPath(reportPath)}`,
  ];

  if (failed.length === 0) {
    for (const result of results) {
      lines.push(`ok: ${result.name} (${result.durationMs}ms)`);
    }
    return lines.join('\n');
  }

  lines.push('failed:');
  for (const result of failed) {
    lines.push(`- ${result.name}: status=${result.status} exit=${result.exitCode ?? 'n/a'} duration=${result.durationMs}ms`);
    lines.push(`  command=${result.command}`);
    const excerpt = singleLine(result.stderrTail || result.stdoutTail);
    if (excerpt) {
      lines.push(`  output=${truncate(excerpt, 900)}`);
    }
  }

  lines.push('codex_feedback:');
  lines.push('模块测试失败，请根据下面失败项修复后重新运行测试。');
  for (const result of failed) {
    lines.push(`[${result.name}] ${result.command}`);
    const excerpt = singleLine(result.stderrTail || result.stdoutTail);
    if (excerpt) {
      lines.push(truncate(excerpt, 900));
    }
  }
  lines.push(`完整测试报告: ${relativeDisplayPath(reportPath)}`);
  return lines.join('\n');
}

function resolveTestCwd(base: string, value: unknown): string {
  const text = String(value || '.').trim();
  return path.resolve(base, text || '.');
}

function readPositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeModuleKind(value: unknown): ModuleKind {
  const text = String(value || 'auto').trim().toLowerCase();
  return ['auto', 'node', 'python', 'static', 'custom'].includes(text) ? text as ModuleKind : 'auto';
}

function createRunId(): string {
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
  return `module-test-${stamp}-${randomUUID().slice(0, 8)}`;
}

function safeSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'test';
}

function quoteForShell(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function tail(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value.trim();
  }
  return value.slice(value.length - maxChars).trim();
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? value.slice(0, maxChars - 3) + '...' : value;
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function readReportLogArtifacts(reportRef: string, workingDirectory: string): ArtifactManifestItem[] {
  const reportPath = resolveArtifactPath(reportRef, workingDirectory);
  if (!reportPath) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    const results = Array.isArray(parsed?.results) ? parsed.results : [];
    return results.flatMap((item: any) => [
      artifactFromPath(item?.stdoutFile, 'generated', workingDirectory),
      artifactFromPath(item?.stderrFile, 'generated', workingDirectory),
    ]).filter((item: ArtifactManifestItem | undefined): item is ArtifactManifestItem => Boolean(item));
  } catch {
    return [];
  }
}

function artifactFromPath(
  value: unknown,
  action: ArtifactManifestItem['action'],
  workingDirectory: string,
): ArtifactManifestItem | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = workspaceRelativeArtifactPath(value, workingDirectory);
  return {
    path: normalized,
    type: artifactType(normalized),
    action,
  };
}

function keyValue(text: string, key: string): string {
  const pattern = new RegExp(`^${key}=([^\\r\\n]+)$`, 'm');
  return pattern.exec(String(text || ''))?.[1]?.trim() || '';
}

function resolveArtifactPath(value: string, workingDirectory: string): string {
  const text = String(value || '').trim();
  if (!text) return '';
  if (path.isAbsolute(text)) return text;
  const contextPath = path.resolve(workingDirectory, text);
  if (fs.existsSync(contextPath)) return contextPath;
  return path.resolve(process.cwd(), text);
}

function workspaceRelativeArtifactPath(value: string, workingDirectory: string): string {
  const normalized = value.trim().replace(/\\/g, '/');
  const cwd = workingDirectory.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalized.startsWith(`${cwd}/`)) {
    return normalized.slice(cwd.length + 1);
  }
  return normalized.replace(/^\/+/, '');
}

function artifactType(filePath: string): string {
  const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
  return ext || 'file';
}

function uniqueArtifacts(items: ArtifactManifestItem[]): ArtifactManifestItem[] {
  const seen = new Set<string>();
  const unique: ArtifactManifestItem[] = [];
  for (const item of items) {
    const key = `${item.path}\0${item.action}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function relativeDisplayPath(filePath: string): string {
  const relative = path.relative(process.cwd(), filePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative
    : filePath;
}
