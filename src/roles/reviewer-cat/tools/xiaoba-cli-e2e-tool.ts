import { exec, execFile, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ArtifactManifestItem, Tool, ToolDefinition, ToolExecutionContext } from '../../../types/tool';
import { prepareReviewEval } from '../utils/review-eval-profile';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const DEFAULT_MAX_CHARS = 4200;
const DEFAULT_STARTUP_WAIT_MS = 1500;
const DEFAULT_WAIT_AFTER_MESSAGE_MS = 5000;
const DEFAULT_MAX_WAIT_MS = 60000;
const DEFAULT_VERIFIER_TIMEOUT_MS = 120000;
const MAX_BUFFER = 10 * 1024 * 1024;

type E2EDecision = 'pass' | 'fail' | 'partial' | 'blocked';
type RequestedSurface = 'auto' | 'tmux' | 'process';
type ActualSurface = 'tmux' | 'process';

interface VerifierSpec {
  name: string;
  command: string;
  timeoutMs: number;
}

interface VerifierResult {
  name: string;
  command: string;
  status: 'passed' | 'failed' | 'timeout';
  exitCode: number | string | null;
  durationMs: number;
  stdoutFile: string;
  stderrFile: string;
  stdoutTail: string;
  stderrTail: string;
}

interface E2EManifest {
  version: 1;
  runId: string;
  project: 'xiaoba-cli';
  surface: ActualSurface;
  requestedSurface: RequestedSurface;
  targetRole: string;
  cwd: string;
  startedAt: string;
  completedAt?: string;
  tmuxSession?: string;
  processPid?: number;
  command: string;
  messages: string[];
  completionPatterns: string[];
  sessionLogPaths: string[];
  tracePaths: Record<string, string>;
  verifierResults: Array<Pick<VerifierResult, 'name' | 'command' | 'status' | 'exitCode' | 'durationMs'>>;
  decision: E2EDecision;
  score: number;
  blockedReason?: string;
  fallbackReason?: string;
}

export class ReviewerXiaoBaCliE2ETool implements Tool {
  definition: ToolDefinition = {
    name: 'reviewer_xiaoba_cli_e2e',
    description: [
      '让 ReviewerCat 像真人测试人员一样，通过真实 CLI 入口黑盒交互端到端测试 XiaoBa-CLI 的目标角色。',
      '默认目标是 engineer-cat：启动真实 CLI interactive session，发送需求，capture 终端 trace，跑独立 verifier，并写 scorecard/report。',
      '默认优先 tmux；tmux 不可用时可在 auto 模式降级到子进程 stdin/stdout，并把降级事实写入 trace/scorecard。'
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description: 'XiaoBa-CLI 仓库目录，默认当前工作目录。'
        },
        run_id: {
          type: 'string',
          description: '可选 E2E run id；不填自动生成。'
        },
        target_role: {
          type: 'string',
          description: '被测角色，默认 engineer-cat。'
        },
        surface: {
          type: 'string',
          enum: ['auto', 'tmux', 'process'],
          description: '交互入口。auto 默认优先 tmux，tmux 不可用时退到真实 CLI 子进程 stdin/stdout；tmux 表示强制 tmux；process 表示强制子进程交互。'
        },
        scenario: {
          type: 'string',
          description: '本次拟人测试需求。未提供时使用只读安全探测需求。'
        },
        messages: {
          type: 'array',
          description: '要按顺序发给被测 agent 的人类消息。未提供时使用 scenario 作为首条消息。',
          items: { type: 'string' }
        },
        command: {
          type: 'string',
          description: '启动目标 CLI 的命令；默认 node dist/index.js chat --role <target_role> --interactive。'
        },
        tmux_binary: {
          type: 'string',
          description: 'tmux 可执行文件路径，默认 tmux。测试时可传 fake tmux。'
        },
        tmux_session: {
          type: 'string',
          description: '可选 tmux session 名。'
        },
        keep_session: {
          type: 'boolean',
          description: '是否保留 tmux session 供人工继续观察，默认 false。'
        },
        startup_wait_ms: {
          type: 'number',
          description: '启动后首次 capture 前等待时间，默认 1500。'
        },
        wait_after_message_ms: {
          type: 'number',
          description: '每条人类消息发送后等待时间，默认 5000。'
        },
        max_wait_ms: {
          type: 'number',
          description: '所有消息发送后继续等待 completion pattern 的最长时间，默认 60000。'
        },
        completion_patterns: {
          type: 'array',
          description: '认为被测 agent 到达阶段性完成的文本模式，默认包含 完成/done/交付/验证。',
          items: { type: 'string' }
        },
        verifier_commands: {
          type: 'array',
          description: '独立 verifier 命令。默认跑 node dist/index.js --help。',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'verifier 名称。' },
              command: { type: 'string', description: 'verifier 命令。' },
              timeout_ms: { type: 'number', description: '超时时间，默认 120000ms。' }
            },
            required: ['command']
          }
        },
        max_chars: {
          type: 'number',
          description: '最大返回字符数，默认 4200。完整 trace/report 会落盘。'
        }
      }
    }
  };

  async execute(args: any, context: ToolExecutionContext): Promise<string> {
    const cwd = resolveCwd(context.workingDirectory, args?.cwd);
    const targetRole = readString(args?.target_role, 'engineer-cat');
    const runId = safeSegment(readString(args?.run_id, createRunId()));
    const scenario = readString(args?.scenario, defaultScenario(targetRole));
    const messages = normalizeMessages(args?.messages, scenario);
    const completionPatterns = normalizeStringArray(args?.completion_patterns, ['完成', 'done', '交付', '验证', '已完成']);
    const requestedSurface = normalizeSurface(args?.surface);
    const maxChars = readPositiveNumber(args?.max_chars, DEFAULT_MAX_CHARS);
    const startupWaitMs = readNonNegativeNumber(args?.startup_wait_ms, DEFAULT_STARTUP_WAIT_MS);
    const waitAfterMessageMs = readNonNegativeNumber(args?.wait_after_message_ms, DEFAULT_WAIT_AFTER_MESSAGE_MS);
    const maxWaitMs = readNonNegativeNumber(args?.max_wait_ms, DEFAULT_MAX_WAIT_MS);
    const tmuxBinary = readString(args?.tmux_binary, 'tmux');
    const tmuxSession = safeTmuxSession(readString(args?.tmux_session, `reviewer-e2e-${runId}`));
    const keepSession = args?.keep_session === true;
    const command = readString(args?.command, `node dist/index.js chat --role ${quoteForShell(targetRole)} --interactive`);
    const verifiers = normalizeVerifiers(args?.verifier_commands);

    const prepared = prepareReviewEval({
      cwd,
      reviewId: runId,
      request: `True E2E test XiaoBa-CLI ${targetRole} via ${requestedSurface} surface.`,
      implementationSummary: 'ReviewerCat acts like a human tester: starts the CLI, talks to the target role, captures trace, and verifies independently.',
      changedFiles: [],
    });
    const runDir = prepared.runDir;
    if (args && typeof args === 'object') {
      args.__xiaoba_artifact_run_id = runId;
      args.__xiaoba_artifact_run_dir = runDir;
    }
    const traceDir = path.join(runDir, 'trace');
    const evidenceDir = path.join(runDir, 'evidence');
    fs.mkdirSync(traceDir, { recursive: true });
    fs.mkdirSync(evidenceDir, { recursive: true });

    const startedAt = new Date();
    const traceEventsPath = path.join(traceDir, 'normalized-transcript.jsonl');
    const capturesPath = path.join(traceDir, 'tmux-captures.jsonl');
    const rawPanePath = path.join(traceDir, 'tmux-pane.raw.log');
    const cleanPanePath = path.join(traceDir, 'tmux-pane.clean.log');
    const manifestPath = path.join(traceDir, 'manifest.json');
    const scorecardPath = path.join(runDir, 'scorecard.json');
    const reportPath = path.join(runDir, 'report.md');
    const taskPath = path.join(runDir, 'e2e-task.json');
    const gitBeforePath = path.join(evidenceDir, 'git-status.before.txt');
    const gitAfterPath = path.join(evidenceDir, 'git-status.after.txt');

    writeJson(taskPath, {
      version: 1,
      runId,
      targetRole,
      requestedSurface,
      cwd,
      command,
      scenario,
      messages,
      completionPatterns,
    });
    fs.writeFileSync(gitBeforePath, await captureCommand('git status --short', cwd), 'utf-8');

    const tmuxCheck = await checkTmux(tmuxBinary);
    const actualSurface: ActualSurface = requestedSurface === 'process'
      ? 'process'
      : (tmuxCheck.ok ? 'tmux' : (requestedSurface === 'auto' ? 'process' : 'tmux'));
    let blockedReason: string | undefined;
    let interactionStarted = false;
    let completionMatched = false;
    let finalCapture = '';
    let processPid: number | undefined;
    let fallbackReason: string | undefined;
    const errors: string[] = [];

    appendEvent(traceEventsPath, { type: 'state', state: 'starting', at: new Date().toISOString(), surface: actualSurface, session: tmuxSession });

    if (!tmuxCheck.ok && requestedSurface === 'tmux') {
      blockedReason = tmuxCheck.error || 'tmux is unavailable';
      errors.push(blockedReason);
      appendEvent(traceEventsPath, { type: 'state', state: 'blocked', reason: blockedReason, at: new Date().toISOString() });
    } else if (actualSurface === 'process') {
      if (!tmuxCheck.ok && requestedSurface === 'auto') {
        fallbackReason = tmuxCheck.error || 'tmux is unavailable; falling back to process surface';
        appendEvent(traceEventsPath, { type: 'surface_fallback', from: 'tmux', to: 'process', reason: fallbackReason, at: new Date().toISOString() });
      }
      try {
        const result = await runProcessInteraction({
          command,
          cwd,
          messages,
          completionPatterns,
          startupWaitMs,
          waitAfterMessageMs,
          maxWaitMs,
          traceEventsPath,
          capturesPath,
        });
        interactionStarted = result.started;
        completionMatched = result.completionMatched;
        finalCapture = result.output;
        processPid = result.pid;
        errors.push(...result.errors);
      } catch (error: any) {
        errors.push(String(error?.message || error || 'unknown process interaction error'));
        appendEvent(traceEventsPath, { type: 'state', state: 'failed', reason: errors[errors.length - 1], at: new Date().toISOString() });
      }
    } else {
      try {
        await startTmuxSession(tmuxBinary, tmuxSession, cwd, command);
        interactionStarted = true;
        appendEvent(traceEventsPath, { type: 'state', state: 'running', at: new Date().toISOString(), command });
        await sleep(startupWaitMs);
        finalCapture = await capturePane(tmuxBinary, tmuxSession);
        appendCapture(capturesPath, 'startup', finalCapture);

        for (const [index, message] of messages.entries()) {
          await sendTmuxMessage(tmuxBinary, tmuxSession, `reviewer-${runId}-${index}`, message);
          appendEvent(traceEventsPath, { type: 'human_message', text: message, at: new Date().toISOString() });
          await sleep(waitAfterMessageMs);
          finalCapture = await capturePane(tmuxBinary, tmuxSession);
          appendCapture(capturesPath, `after-message-${index + 1}`, finalCapture);
          if (matchesAny(finalCapture, completionPatterns)) {
            completionMatched = true;
            break;
          }
        }

        const deadline = Date.now() + maxWaitMs;
        while (!completionMatched && Date.now() < deadline) {
          await sleep(Math.min(2000, Math.max(250, deadline - Date.now())));
          finalCapture = await capturePane(tmuxBinary, tmuxSession);
          appendCapture(capturesPath, 'poll', finalCapture);
          completionMatched = matchesAny(finalCapture, completionPatterns);
          if (maxWaitMs === 0) break;
        }

        if (!keepSession) {
          await sendTmuxMessage(tmuxBinary, tmuxSession, `reviewer-${runId}-exit`, '/exit').catch(() => undefined);
          await sleep(300);
        }
      } catch (error: any) {
        errors.push(String(error?.message || error || 'unknown tmux error'));
        appendEvent(traceEventsPath, { type: 'state', state: 'failed', reason: errors[errors.length - 1], at: new Date().toISOString() });
      } finally {
        if (interactionStarted) {
          finalCapture = finalCapture || await capturePane(tmuxBinary, tmuxSession).catch(() => '');
          if (!keepSession) {
            await killTmuxSession(tmuxBinary, tmuxSession).catch(() => undefined);
          }
        }
      }
    }

    fs.writeFileSync(rawPanePath, finalCapture, 'utf-8');
    fs.writeFileSync(cleanPanePath, stripAnsi(finalCapture), 'utf-8');

    const verifierResults: VerifierResult[] = [];
    for (const [index, verifier] of verifiers.entries()) {
      verifierResults.push(await runVerifier(verifier, cwd, evidenceDir, index + 1));
    }
    fs.writeFileSync(gitAfterPath, await captureCommand('git status --short', cwd), 'utf-8');

    const sessionLogPaths = collectSessionLogs(cwd, startedAt.getTime());
    const threeLayerEvidence = summarizeThreeLayerEvidence({
      cwd,
      sessionLogPaths,
      traceEventsPath,
      cleanPanePath,
      finalCapture,
    });
    const decision = decide({
      blockedReason,
      interactionStarted,
      completionMatched,
      verifierResults,
      errors,
    });
    const score = scoreRun({
      decision,
      interactionStarted,
      completionMatched,
      verifierResults,
      sessionLogPaths,
      errors,
    });
    const completedAt = new Date().toISOString();
    const roleEffectiveness = buildRoleEffectivenessScore({
      decision,
      targetRole,
      actualSurface,
      messages,
      interactionStarted,
      completionMatched,
      verifierResults,
      sessionLogPaths,
      errors,
      threeLayerEvidence,
    });

    const manifest: E2EManifest = {
      version: 1,
      runId,
      project: 'xiaoba-cli',
      surface: actualSurface,
      requestedSurface,
      targetRole,
      cwd,
      startedAt: startedAt.toISOString(),
      completedAt,
      tmuxSession: actualSurface === 'tmux' ? tmuxSession : undefined,
      processPid,
      command,
      messages,
      completionPatterns,
      sessionLogPaths,
      tracePaths: mapRelativePaths({
        task: taskPath,
        normalizedTranscript: traceEventsPath,
        tmuxCaptures: capturesPath,
        rawPane: rawPanePath,
        cleanPane: cleanPanePath,
        gitStatusBefore: gitBeforePath,
        gitStatusAfter: gitAfterPath,
      }, cwd),
      verifierResults: verifierResults.map(result => ({
        name: result.name,
        command: result.command,
        status: result.status,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
      })),
      decision,
      score,
      blockedReason,
      fallbackReason,
    };
    writeJson(manifestPath, manifest);

    const scorecard = {
      version: 1,
      runId,
      target: {
        project: 'xiaoba-cli',
        role: targetRole,
        surface: actualSurface,
      },
      decision,
      score,
      dimensions: {
        entrypointReality: interactionStarted ? (actualSurface === 'tmux' ? 20 : 16) : 0,
        humanLikeInteraction: messages.length > 0 && interactionStarted ? 15 : 0,
        taskCompletionSignal: completionMatched ? 15 : 0,
        independentVerification: verifierResults.length > 0 && verifierResults.every(result => result.status === 'passed') ? 20 : 0,
        traceCompleteness: finalCapture.trim() ? 15 : 0,
        sessionLogEvidence: sessionLogPaths.length > 0 ? 10 : 0,
        cleanup: keepSession || !interactionStarted ? 0 : 5,
      },
      blockedReason,
      fallbackReason,
      errors,
      rubric: {
        minimumPassingScore: 80,
        dimensions: roleEffectiveness.dimensions.map((dimension: any) => ({
          id: dimension.id,
          maxScore: dimension.maxScore,
          requirement: dimension.requirement,
        })),
        gates: [
          'real entrypoint interaction must start or the run is blocked',
          'human-like task must produce an observable completion signal or residual risk',
          'independent verifier evidence must pass for release-gate closure',
          'three-layer evidence must be observed or explicitly listed as missing',
        ],
      },
      roleEffectiveness,
      threeLayerEvidence,
      evidence: {
        traceManifest: path.relative(runDir, manifestPath).replace(/\\/g, '/'),
        rawPane: path.relative(runDir, rawPanePath).replace(/\\/g, '/'),
        cleanPane: path.relative(runDir, cleanPanePath).replace(/\\/g, '/'),
        sessionLogs: sessionLogPaths,
        verifiers: verifierResults.map(result => ({
          name: result.name,
          status: result.status,
          stdoutFile: path.relative(runDir, result.stdoutFile).replace(/\\/g, '/'),
          stderrFile: path.relative(runDir, result.stderrFile).replace(/\\/g, '/'),
        })),
      },
      residualRisks: residualRisks(decision, completionMatched, sessionLogPaths, keepSession, actualSurface, fallbackReason),
    };
    writeJson(scorecardPath, scorecard);
    fs.writeFileSync(reportPath, renderReport({
      manifest,
      scorecard,
      verifierResults,
      runDir,
      reportPath,
      errors,
    }), 'utf-8');
    appendEvent(traceEventsPath, { type: 'state', state: decision, score, at: completedAt });

    return truncate(formatCompactResult({
      decision,
      score,
      runId,
      targetRole,
      surface: actualSurface,
      runDir,
      manifestPath,
      reportPath,
      scorecardPath,
      interactionStarted,
      completionMatched,
      verifierResults,
      blockedReason,
      fallbackReason,
      roleEffectiveness,
      threeLayerEvidence,
    }, context.workingDirectory), maxChars);
  }

  getArtifactManifest(args: any, result: string, context: ToolExecutionContext): ArtifactManifestItem[] {
    const runDir = inferE2ERunDir(args, result, context.workingDirectory);
    if (!runDir) return [];

    const artifacts = [
      artifactFromPath(path.join(runDir, 'e2e-task.json'), 'generated', context.workingDirectory, {
        artifact_role: 'e2e_task',
        tool: 'reviewer_xiaoba_cli_e2e',
      }),
      artifactFromPath(path.join(runDir, 'trace', 'manifest.json'), 'generated', context.workingDirectory, {
        artifact_role: 'trace_manifest',
        tool: 'reviewer_xiaoba_cli_e2e',
      }),
      artifactFromPath(path.join(runDir, 'trace', 'normalized-transcript.jsonl'), 'captured', context.workingDirectory, {
        artifact_role: 'working_trace',
        tool: 'reviewer_xiaoba_cli_e2e',
      }),
      artifactFromPath(path.join(runDir, 'trace', 'tmux-captures.jsonl'), 'captured', context.workingDirectory, {
        artifact_role: 'surface_capture',
        tool: 'reviewer_xiaoba_cli_e2e',
      }),
      artifactFromPath(path.join(runDir, 'trace', 'tmux-pane.raw.log'), 'captured', context.workingDirectory, {
        artifact_role: 'raw_surface_log',
        tool: 'reviewer_xiaoba_cli_e2e',
      }),
      artifactFromPath(path.join(runDir, 'trace', 'tmux-pane.clean.log'), 'captured', context.workingDirectory, {
        artifact_role: 'clean_surface_log',
        tool: 'reviewer_xiaoba_cli_e2e',
      }),
      artifactFromPath(path.join(runDir, 'scorecard.json'), 'generated', context.workingDirectory, {
        artifact_role: 'scorecard',
        tool: 'reviewer_xiaoba_cli_e2e',
      }),
      artifactFromPath(path.join(runDir, 'report.md'), 'generated', context.workingDirectory, {
        artifact_role: 'review_report',
        tool: 'reviewer_xiaoba_cli_e2e',
      }),
      artifactFromPath(path.join(runDir, 'evidence', 'git-status.before.txt'), 'captured', context.workingDirectory, {
        artifact_role: 'workspace_status',
        tool: 'reviewer_xiaoba_cli_e2e',
      }),
      artifactFromPath(path.join(runDir, 'evidence', 'git-status.after.txt'), 'captured', context.workingDirectory, {
        artifact_role: 'workspace_status',
        tool: 'reviewer_xiaoba_cli_e2e',
      }),
      ...readE2EVerifierArtifacts(runDir, context.workingDirectory),
    ];

    return uniqueArtifacts(artifacts.filter((item): item is ArtifactManifestItem => Boolean(item)));
  }
}

function defaultScenario(targetRole: string): string {
  return [
    `你现在是被测对象 ${targetRole}。`,
    '请按真实高级工程师方式响应这个测试需求：先复述目标、指出你需要的边界信息、说明你会如何调用 Codex runner、会跑哪些验证，并给出可交付证据清单。',
    '这是一轮只读 E2E 能力探测，除非我明确要求，不要修改文件。'
  ].join('\n');
}

async function checkTmux(tmuxBinary: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await execFileAsync(tmuxBinary, ['-V'], { timeout: 5000 });
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: `tmux unavailable: ${String(error?.message || error)}` };
  }
}

async function startTmuxSession(tmuxBinary: string, sessionName: string, cwd: string, command: string): Promise<void> {
  const shellCommand = `cd ${quoteForShell(cwd)} && ${command}`;
  await execFileAsync(tmuxBinary, ['new-session', '-d', '-s', sessionName, shellCommand], {
    timeout: 10000,
    maxBuffer: MAX_BUFFER,
  });
}

async function sendTmuxMessage(tmuxBinary: string, sessionName: string, bufferName: string, message: string): Promise<void> {
  await execFileAsync(tmuxBinary, ['set-buffer', '-b', bufferName, message], { timeout: 5000, maxBuffer: MAX_BUFFER });
  await execFileAsync(tmuxBinary, ['paste-buffer', '-b', bufferName, '-t', sessionName], { timeout: 5000, maxBuffer: MAX_BUFFER });
  await execFileAsync(tmuxBinary, ['send-keys', '-t', sessionName, 'C-m'], { timeout: 5000, maxBuffer: MAX_BUFFER });
}

async function capturePane(tmuxBinary: string, sessionName: string): Promise<string> {
  const result = await execFileAsync(tmuxBinary, ['capture-pane', '-pt', sessionName, '-S', '-5000'], {
    timeout: 10000,
    maxBuffer: MAX_BUFFER,
    encoding: 'utf-8',
  });
  return result.stdout || '';
}

async function killTmuxSession(tmuxBinary: string, sessionName: string): Promise<void> {
  await execFileAsync(tmuxBinary, ['kill-session', '-t', sessionName], {
    timeout: 5000,
    maxBuffer: MAX_BUFFER,
  });
}

async function runProcessInteraction(input: {
  command: string;
  cwd: string;
  messages: string[];
  completionPatterns: string[];
  startupWaitMs: number;
  waitAfterMessageMs: number;
  maxWaitMs: number;
  traceEventsPath: string;
  capturesPath: string;
}): Promise<{ started: boolean; pid?: number; output: string; completionMatched: boolean; errors: string[] }> {
  const child = spawn(input.command, {
    cwd: input.cwd,
    shell: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let output = '';
  let exited = false;
  const errors: string[] = [];
  const exitPromise = new Promise<void>(resolve => {
    child.stdout.on('data', chunk => {
      output += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      output += chunk.toString();
    });
    child.on('error', error => {
      errors.push(error.message);
    });
    child.on('close', (code, signal) => {
      exited = true;
      appendEvent(input.traceEventsPath, {
        type: 'state',
        state: 'process_closed',
        exitCode: code,
        signal,
        at: new Date().toISOString(),
      });
      resolve();
    });
  });

  appendEvent(input.traceEventsPath, { type: 'state', state: 'running', surface: 'process', pid: child.pid, at: new Date().toISOString(), command: input.command });
  await sleep(input.startupWaitMs);
  appendCapture(input.capturesPath, 'startup', output);

  let completionMatched = matchesAny(output, input.completionPatterns);
  for (const [index, message] of input.messages.entries()) {
    if (exited) break;
    child.stdin.write(`${message}\n`);
    appendEvent(input.traceEventsPath, { type: 'human_message', text: message, at: new Date().toISOString() });
    await sleep(input.waitAfterMessageMs);
    appendCapture(input.capturesPath, `after-message-${index + 1}`, output);
    completionMatched = matchesAny(output, input.completionPatterns);
    if (completionMatched) break;
  }

  const deadline = Date.now() + input.maxWaitMs;
  while (!completionMatched && !exited && Date.now() < deadline) {
    await sleep(Math.min(2000, Math.max(250, deadline - Date.now())));
    appendCapture(input.capturesPath, 'poll', output);
    completionMatched = matchesAny(output, input.completionPatterns);
    if (input.maxWaitMs === 0) break;
  }

  if (!exited) {
    child.stdin.write('/exit\n');
    await Promise.race([exitPromise, sleep(1000)]);
  }
  if (!exited) {
    child.kill('SIGTERM');
    await Promise.race([exitPromise, sleep(2000)]);
  }
  if (!exited) {
    child.kill('SIGKILL');
    await Promise.race([exitPromise, sleep(500)]);
  }

  return {
    started: true,
    pid: child.pid,
    output,
    completionMatched,
    errors,
  };
}

async function runVerifier(verifier: VerifierSpec, cwd: string, evidenceDir: string, index: number): Promise<VerifierResult> {
  const started = Date.now();
  let stdout = '';
  let stderr = '';
  let status: VerifierResult['status'] = 'passed';
  let exitCode: number | string | null = 0;

  try {
    const result = await execAsync(verifier.command, {
      cwd,
      timeout: verifier.timeoutMs,
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

  const prefix = `${String(index).padStart(2, '0')}-${safeSegment(verifier.name)}`;
  const stdoutFile = path.join(evidenceDir, `${prefix}.stdout.log`);
  const stderrFile = path.join(evidenceDir, `${prefix}.stderr.log`);
  fs.writeFileSync(stdoutFile, stdout, 'utf-8');
  fs.writeFileSync(stderrFile, stderr, 'utf-8');

  return {
    name: verifier.name,
    command: verifier.command,
    status,
    exitCode,
    durationMs: Date.now() - started,
    stdoutFile,
    stderrFile,
    stdoutTail: tail(stdout, 1200),
    stderrTail: tail(stderr, 1200),
  };
}

async function captureCommand(command: string, cwd: string): Promise<string> {
  try {
    const result = await execAsync(command, {
      cwd,
      timeout: 10000,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      encoding: 'utf-8',
    });
    return result.stdout || '';
  } catch (error: any) {
    return [error?.stdout || '', error?.stderr || error?.message || ''].filter(Boolean).join('\n');
  }
}

function decide(input: {
  blockedReason?: string;
  interactionStarted: boolean;
  completionMatched: boolean;
  verifierResults: VerifierResult[];
  errors: string[];
}): E2EDecision {
  if (input.blockedReason) return 'blocked';
  if (!input.interactionStarted) return 'blocked';
  if (input.errors.length > 0) return 'fail';
  if (input.verifierResults.some(result => result.status !== 'passed')) return 'fail';
  if (!input.completionMatched) return 'partial';
  return 'pass';
}

function scoreRun(input: {
  decision: E2EDecision;
  interactionStarted: boolean;
  completionMatched: boolean;
  verifierResults: VerifierResult[];
  sessionLogPaths: string[];
  errors: string[];
}): number {
  if (input.decision === 'blocked') return input.verifierResults.every(result => result.status === 'passed') ? 35 : 20;
  let score = 0;
  if (input.interactionStarted) score += 20;
  if (input.completionMatched) score += 20;
  if (input.verifierResults.length > 0 && input.verifierResults.every(result => result.status === 'passed')) score += 25;
  if (input.sessionLogPaths.length > 0) score += 10;
  if (input.errors.length === 0) score += 15;
  score += 10;
  return Math.max(0, Math.min(100, score));
}

function summarizeThreeLayerEvidence(input: {
  cwd: string;
  sessionLogPaths: string[];
  traceEventsPath: string;
  cleanPanePath: string;
  finalCapture: string;
}): Record<string, any> {
  const entries = readSessionEntries(input.cwd, input.sessionLogPaths);
  const hasTurn = entries.some(entry => entry?.entry_type === 'trace' || entry?.entry_type === 'turn');
  const hasRuntime = entries.some(entry => entry?.entry_type === 'runtime');
  const hasAssistantToolCalls = entries.some(entry => Array.isArray(entry?.assistant?.tool_calls) && entry.assistant.tool_calls.length > 0);
  const hasToolResult = entries.some(entry => entry?.entry_type === 'tool' || entry?.tool_call_id || entry?.tool_result);
  const hasTokens = entries.some(entry => entry?.tokens);
  const hasTraceEvents = fs.existsSync(input.traceEventsPath) && fs.statSync(input.traceEventsPath).size > 0;
  const hasCleanPane = fs.existsSync(input.cleanPanePath) && fs.statSync(input.cleanPanePath).size > 0;

  const durableSession = {
    status: input.sessionLogPaths.length > 0 ? 'observed' : 'missing',
    evidence: input.sessionLogPaths,
    notes: input.sessionLogPaths.length > 0
      ? ['session JSONL was discovered after the E2E run']
      : ['no logs/sessions JSONL was discovered for this run'],
  };
  const workingTrace = {
    status: hasTraceEvents && (hasCleanPane || input.finalCapture.trim()) ? 'observed' : 'missing',
    evidence: ['trace/normalized-transcript.jsonl', 'trace/tmux-pane.clean.log'].filter(item => {
      const absolute = path.join(path.dirname(input.traceEventsPath), path.basename(item));
      return item.includes('normalized') ? hasTraceEvents : fs.existsSync(absolute);
    }),
    notes: hasTraceEvents
      ? ['reviewer captured human messages, terminal captures, and state transitions']
      : ['reviewer trace events were not captured'],
  };
  const providerTranscript = {
    status: hasTurn ? (hasAssistantToolCalls || hasToolResult || hasTokens || hasRuntime ? 'observed' : 'partial') : 'missing',
    evidence: input.sessionLogPaths,
    notes: hasTurn
      ? ['session log contains turn-level provider/runtime evidence; inspect raw JSONL for exact provider-visible payload when closing a release gate']
      : ['no turn-level session entry was found'],
  };
  const issues: string[] = [];
  if (durableSession.status === 'missing') issues.push('durable session evidence missing');
  if (workingTrace.status === 'missing') issues.push('working trace evidence missing');
  if (providerTranscript.status === 'missing') issues.push('provider transcript evidence missing');
  if (hasAssistantToolCalls && !hasToolResult) issues.push('assistant tool calls were observed without matching tool-result evidence in discovered logs');

  return { durableSession, workingTrace, providerTranscript, issues };
}

function buildRoleEffectivenessScore(input: {
  decision: E2EDecision;
  targetRole: string;
  actualSurface: ActualSurface;
  messages: string[];
  interactionStarted: boolean;
  completionMatched: boolean;
  verifierResults: VerifierResult[];
  sessionLogPaths: string[];
  errors: string[];
  threeLayerEvidence: Record<string, any>;
}): Record<string, any> {
  const verifierPassed = input.verifierResults.length > 0 && input.verifierResults.every(result => result.status === 'passed');
  const threeLayerObserved = ['durableSession', 'workingTrace', 'providerTranscript']
    .filter(layer => input.threeLayerEvidence[layer]?.status === 'observed').length;
  const dimensions = [
    {
      id: 'contractUnderstanding',
      maxScore: 15,
      score: input.completionMatched ? 15 : 6,
      requirement: 'role response shows it understood its own responsibility boundary and task goal',
      evidence: input.completionMatched ? ['completion pattern matched'] : ['completion pattern missing'],
    },
    {
      id: 'entrypointReality',
      maxScore: 15,
      score: input.interactionStarted ? (input.actualSurface === 'tmux' ? 15 : 12) : 0,
      requirement: 'role is exercised through a real XiaoBa CLI interaction surface',
      evidence: [`surface=${input.actualSurface}`, `interactionStarted=${input.interactionStarted}`],
    },
    {
      id: 'humanLikeTaskExecution',
      maxScore: 15,
      score: input.messages.length > 0 && input.interactionStarted ? 15 : 0,
      requirement: 'reviewer sends natural user messages and captures the target role behavior',
      evidence: [`messages=${input.messages.length}`],
    },
    {
      id: 'toolSkillBoundary',
      maxScore: 15,
      score: input.sessionLogPaths.length > 0 ? 15 : 6,
      requirement: 'role action can be tied to runtime session/tool/skill evidence or a recorded missing-evidence risk',
      evidence: input.sessionLogPaths,
    },
    {
      id: 'threeLayerEvidence',
      maxScore: 15,
      score: threeLayerObserved * 5,
      requirement: 'durable session, working trace, and provider transcript are observed as separate layers',
      evidence: input.threeLayerEvidence.issues.length === 0 ? ['all three layers observed'] : input.threeLayerEvidence.issues,
    },
    {
      id: 'independentVerification',
      maxScore: 15,
      score: verifierPassed ? 15 : 0,
      requirement: 'independent verifier checks pass outside the role self-report',
      evidence: input.verifierResults.map(result => `${result.name}:${result.status}`),
    },
    {
      id: 'decisionAndResidualRisk',
      maxScore: 10,
      score: input.errors.length === 0 && input.decision === 'pass' ? 10 : 4,
      requirement: 'scorecard records decision, errors, and residual risks clearly',
      evidence: input.errors.length > 0 ? input.errors : [`decision=${input.decision}`],
    },
  ];
  const totalScore = dimensions.reduce((sum, dimension) => sum + dimension.score, 0);
  return {
    role: input.targetRole,
    totalScore,
    maximumScore: 100,
    minimumPassingScore: 80,
    rating: totalScore >= 80 && input.decision === 'pass' ? 'effective' : (totalScore >= 60 ? 'partial' : 'ineffective'),
    dimensions,
  };
}

function residualRisks(
  decision: E2EDecision,
  completionMatched: boolean,
  sessionLogPaths: string[],
  keepSession: boolean,
  surface: ActualSurface,
  fallbackReason?: string,
): string[] {
  const risks: string[] = [];
  if (decision === 'partial') risks.push('terminal trace was captured but no completion pattern was observed.');
  if (!completionMatched) risks.push('target agent may still be running or waiting for clarification.');
  if (sessionLogPaths.length === 0) risks.push('no XiaoBa session JSONL log was discovered for this run.');
  if (keepSession) risks.push('tmux session was intentionally left running; manual cleanup may be needed.');
  if (surface === 'process') risks.push('process surface is less human-realistic than tmux because it does not allocate a real terminal pane.');
  if (fallbackReason) risks.push(fallbackReason);
  return risks;
}

function readSessionEntries(cwd: string, sessionLogPaths: string[]): any[] {
  const entries: any[] = [];
  for (const relativePath of sessionLogPaths) {
    const filePath = path.isAbsolute(relativePath) ? relativePath : path.join(cwd, relativePath);
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Ignore malformed log lines; the raw file path remains in evidence.
      }
    }
  }
  return entries;
}

function renderReport(input: {
  manifest: E2EManifest;
  scorecard: any;
  verifierResults: VerifierResult[];
  runDir: string;
  reportPath: string;
  errors: string[];
}): string {
  const lines = [
    '# XiaoBa-CLI True E2E Report',
    '',
    `Run ID: ${input.manifest.runId}`,
    `Target role: ${input.manifest.targetRole}`,
    `Surface: ${input.manifest.surface}`,
    `Decision: ${input.manifest.decision}`,
    `Score: ${input.manifest.score}`,
    input.manifest.blockedReason ? `Blocked reason: ${input.manifest.blockedReason}` : undefined,
    input.manifest.fallbackReason ? `Fallback reason: ${input.manifest.fallbackReason}` : undefined,
    '',
    '## Interaction',
    '',
    `Surface: ${input.manifest.surface}`,
    input.manifest.tmuxSession ? `Tmux session: ${input.manifest.tmuxSession}` : undefined,
    input.manifest.processPid ? `Process pid: ${input.manifest.processPid}` : undefined,
    `Command: ${input.manifest.command}`,
    '',
    'Messages:',
    ...input.manifest.messages.map((message, index) => `${index + 1}. ${message.replace(/\s+/g, ' ').trim()}`),
    '',
    '## Verifiers',
    '',
    ...input.verifierResults.map(result => [
      `- ${result.name}: ${result.status}`,
      `  command: ${result.command}`,
      `  exitCode: ${String(result.exitCode)}`,
      `  stdout: ${path.relative(input.runDir, result.stdoutFile).replace(/\\/g, '/')}`,
      `  stderr: ${path.relative(input.runDir, result.stderrFile).replace(/\\/g, '/')}`,
    ].join('\n')),
    '',
    '## Evidence',
    '',
    `Trace manifest: ${path.relative(input.runDir, path.join(input.runDir, 'trace', 'manifest.json')).replace(/\\/g, '/')}`,
    `Raw pane: ${input.scorecard.evidence.rawPane}`,
    `Clean pane: ${input.scorecard.evidence.cleanPane}`,
    '',
    'Session logs:',
    ...(input.manifest.sessionLogPaths.length > 0 ? input.manifest.sessionLogPaths.map(item => `- ${item}`) : ['- none discovered']),
    '',
    '## Three-Layer Evidence',
    '',
    ...renderThreeLayerEvidence(input.scorecard.threeLayerEvidence),
    '',
    '## Role Effectiveness Score',
    '',
    `Rating: ${input.scorecard.roleEffectiveness.rating}`,
    `Total: ${input.scorecard.roleEffectiveness.totalScore}/${input.scorecard.roleEffectiveness.maximumScore}`,
    '',
    ...input.scorecard.roleEffectiveness.dimensions.map((dimension: any) => [
      `- ${dimension.id}: ${dimension.score}/${dimension.maxScore}`,
      `  requirement: ${dimension.requirement}`,
      `  evidence: ${Array.isArray(dimension.evidence) && dimension.evidence.length > 0 ? dimension.evidence.join(' | ') : 'none'}`,
    ].join('\n')),
    '',
    '## Errors',
    '',
    ...(input.errors.length > 0 ? input.errors.map(item => `- ${item}`) : ['- none']),
    '',
    '## Residual Risks',
    '',
    ...(input.scorecard.residualRisks.length > 0 ? input.scorecard.residualRisks.map((item: string) => `- ${item}`) : ['- none']),
  ].filter((line): line is string => typeof line === 'string');
  return lines.join('\n');
}

function renderThreeLayerEvidence(summary: Record<string, any>): string[] {
  const layers = [
    ['Durable Session', summary.durableSession],
    ['Working Trace', summary.workingTrace],
    ['Provider Transcript', summary.providerTranscript],
  ];
  return [
    ...layers.map(([label, value]) => [
      `- ${label}: ${value?.status || 'missing'}`,
      `  evidence: ${Array.isArray(value?.evidence) && value.evidence.length > 0 ? value.evidence.join(' | ') : 'none'}`,
      `  notes: ${Array.isArray(value?.notes) && value.notes.length > 0 ? value.notes.join(' | ') : 'none'}`,
    ].join('\n')),
    '',
    'Issues:',
    ...(Array.isArray(summary.issues) && summary.issues.length > 0 ? summary.issues.map((item: string) => `- ${item}`) : ['- none']),
  ];
}

function formatCompactResult(input: {
  decision: E2EDecision;
  score: number;
  runId: string;
  targetRole: string;
  surface: ActualSurface;
  runDir: string;
  manifestPath: string;
  reportPath: string;
  scorecardPath: string;
  interactionStarted: boolean;
  completionMatched: boolean;
  verifierResults: VerifierResult[];
  blockedReason?: string;
  fallbackReason?: string;
  roleEffectiveness: Record<string, any>;
  threeLayerEvidence: Record<string, any>;
}, displayRoot: string): string {
  const verifiers = input.verifierResults.map(result => `${result.name}:${result.status}`).join(', ') || 'none';
  const threeLayerIssues = Array.isArray(input.threeLayerEvidence.issues) && input.threeLayerEvidence.issues.length > 0
    ? input.threeLayerEvidence.issues.join('; ')
    : 'none';
  return [
    `reviewer_xiaoba_cli_e2e: status=${input.decision}`,
    `run_id=${input.runId}`,
    `target_role=${input.targetRole}`,
    `surface=${input.surface}`,
    `score=${input.score}`,
    `role_effectiveness=${input.roleEffectiveness.rating}:${input.roleEffectiveness.totalScore}/100`,
    `three_layer_issues=${threeLayerIssues}`,
    `interaction_started=${input.interactionStarted ? 'yes' : 'no'}`,
    `completion_signal=${input.completionMatched ? 'matched' : 'missing'}`,
    `verifiers=${verifiers}`,
    input.blockedReason ? `blocked_reason=${input.blockedReason}` : undefined,
    input.fallbackReason ? `fallback_reason=${input.fallbackReason}` : undefined,
    `run_dir=${relativeDisplayPath(input.runDir, displayRoot)}`,
    `trace_manifest=${relativeDisplayPath(input.manifestPath, displayRoot)}`,
    `scorecard=${relativeDisplayPath(input.scorecardPath, displayRoot)}`,
    `report=${relativeDisplayPath(input.reportPath, displayRoot)}`,
    '',
    'next:',
    '- 打开 clean pane 和 report，看 engineer-cat 是否像真人使用时那样响应。',
    '- 如果 status=partial，把缺失证据作为返工消息再跑一轮。',
    '- 如果 status=blocked，先补缺失入口；如果只是缺 tmux，可改用 surface=auto/process。',
  ].filter(Boolean).join('\n');
}

function normalizeMessages(value: unknown, scenario: string): string[] {
  const messages = normalizeStringArray(value, []);
  return messages.length > 0 ? messages : [scenario];
}

function normalizeSurface(value: unknown): RequestedSurface {
  const text = String(value || 'auto').trim();
  return text === 'tmux' || text === 'process' || text === 'auto' ? text : 'auto';
}

function normalizeVerifiers(value: unknown): VerifierSpec[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ name: 'cli-help', command: 'node dist/index.js --help', timeoutMs: DEFAULT_VERIFIER_TIMEOUT_MS }];
  }
  return value
    .map((item, index) => {
      const command = typeof item === 'string' ? item : String(item?.command || '').trim();
      if (!command) return null;
      return {
        name: safeSegment(String(item?.name || `verifier-${index + 1}`)),
        command,
        timeoutMs: readPositiveNumber(item?.timeout_ms, DEFAULT_VERIFIER_TIMEOUT_MS),
      };
    })
    .filter((item): item is VerifierSpec => !!item);
}

function collectSessionLogs(cwd: string, sinceMs: number): string[] {
  const root = path.join(cwd, 'logs', 'sessions');
  if (!fs.existsSync(root)) return [];
  const result: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      if (!entry.name.endsWith('.jsonl')) continue;
      const stat = fs.statSync(entryPath);
      if (stat.mtimeMs >= sinceMs - 2000) {
        result.push(path.relative(cwd, entryPath).replace(/\\/g, '/'));
      }
    }
  };
  visit(root);
  return result.sort();
}

function appendEvent(filePath: string, event: Record<string, unknown>): void {
  fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, 'utf-8');
}

function appendCapture(filePath: string, label: string, content: string): void {
  appendEvent(filePath, {
    label,
    at: new Date().toISOString(),
    content,
  });
}

function matchesAny(value: string, patterns: string[]): boolean {
  const lower = value.toLowerCase();
  return patterns.some(pattern => {
    const text = pattern.trim();
    return text && lower.includes(text.toLowerCase());
  });
}

function stripAnsi(value: string): string {
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '');
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function inferE2ERunDir(args: any, result: string, workingDirectory: string): string {
  const artifactRunDir = readOptionalString(args?.__xiaoba_artifact_run_dir);
  if (artifactRunDir) return artifactRunDir;

  const resultRunDir = keyValue(result, 'run_dir');
  if (resultRunDir) {
    return path.isAbsolute(resultRunDir)
      ? resultRunDir
      : path.resolve(workingDirectory, resultRunDir);
  }

  const rawRunId = readOptionalString(args?.__xiaoba_artifact_run_id)
    || readOptionalString(args?.run_id)
    || keyValue(result, 'run_id');
  if (!rawRunId) return '';
  const runId = safeSegment(rawRunId);
  const cwd = resolveCwd(workingDirectory, args?.cwd);
  return path.join(cwd, 'data', 'reviewer-runs', runId);
}

function readE2EVerifierArtifacts(runDir: string, workingDirectory: string): ArtifactManifestItem[] {
  const evidenceDir = path.join(runDir, 'evidence');
  if (!fs.existsSync(evidenceDir)) return [];
  return fs.readdirSync(evidenceDir)
    .filter(fileName => /\.(stdout|stderr)\.log$/.test(fileName))
    .sort((left, right) => verifierLogSortKey(left).localeCompare(verifierLogSortKey(right)))
    .map(fileName => artifactFromPath(path.join(evidenceDir, fileName), 'captured', workingDirectory, {
      artifact_role: 'verifier_log',
      tool: 'reviewer_xiaoba_cli_e2e',
    }))
    .filter((item): item is ArtifactManifestItem => Boolean(item));
}

function verifierLogSortKey(fileName: string): string {
  return fileName
    .replace(/\.stdout\.log$/, '.0.log')
    .replace(/\.stderr\.log$/, '.1.log');
}

function artifactFromPath(
  value: unknown,
  action: ArtifactManifestItem['action'],
  workingDirectory: string,
  metadata: Record<string, unknown>,
): ArtifactManifestItem | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = workspaceRelativeArtifactPath(value, workingDirectory);
  return {
    path: normalized,
    type: artifactType(normalized),
    action,
    metadata: {
      ...metadata,
      source: 'tool_owned',
    },
  };
}

function keyValue(text: string, key: string): string {
  const pattern = new RegExp(`^${key}=([^\\r\\n]+)$`, 'm');
  return pattern.exec(String(text || ''))?.[1]?.trim() || '';
}

function readOptionalString(value: unknown): string {
  const text = String(value || '').trim();
  return text || '';
}

function workspaceRelativeArtifactPath(value: string, workingDirectory: string): string {
  const normalized = value.trim().replace(/\\/g, '/');
  const absolute = path.isAbsolute(normalized)
    ? normalized
    : path.resolve(workingDirectory, normalized);
  const relative = path.relative(workingDirectory, absolute).replace(/\\/g, '/');
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative;
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

function mapRelativePaths(paths: Record<string, string>, cwd: string): Record<string, string> {
  return Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, relativeDisplayPath(value, cwd)]));
}

function resolveCwd(base: string, value: unknown): string {
  const text = String(value || '.').trim();
  return path.resolve(base, text || '.');
}

function readString(value: unknown, fallback: string): string {
  const text = String(value || '').trim();
  return text || fallback;
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const items = value.map(item => String(item || '').trim()).filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function readPositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function relativeDisplayPath(filePath: string, root: string): string {
  const relative = path.relative(root, filePath).replace(/\\/g, '/');
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : filePath;
}

function tail(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(-maxChars);
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 3) return value.slice(0, maxChars);
  return `${value.slice(0, maxChars - 3)}...`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  return `xiaoba-e2e-${stamp}-${randomUUID().slice(0, 8)}`;
}

function safeSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'run';
}

function safeTmuxSession(value: string): string {
  return safeSegment(value).replace(/[.]/g, '-').slice(0, 80) || `reviewer-e2e-${randomUUID().slice(0, 8)}`;
}

function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
