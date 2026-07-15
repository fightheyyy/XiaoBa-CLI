import * as fs from 'fs';
import * as path from 'path';
import { ArenaOutputContractCheck } from './types';

export interface ArenaTraceOutputContract {
  linePrefixes: string[];
  subjectSkillId: string | null;
}

export interface ArenaTraceRunClaim {
  runId: string;
  sessionKey?: string;
  expectedTurns: number;
  blockedReason?: string;
}

export interface ArenaTraceTurnViolation {
  turn: number;
  traceId: string;
  reasons: string[];
}

export interface ArenaTraceSessionAttestation {
  runId: string;
  sessionKey?: string;
  tracePath?: string;
  traceRef?: string;
  expectedTurns: number;
  checkedTurns: number;
  passedTurns: number;
  violations: ArenaTraceTurnViolation[];
  identityBlockedReasons: string[];
  contractBlockedReasons: string[];
  blockedReasons: string[];
  identityStatus: 'pass' | 'blocked';
  status: 'pass' | 'fail' | 'blocked';
}

export interface ArenaTraceIdentityCheck {
  expected_sessions: number;
  verified_sessions: number;
  expected_turns: number;
  checked_turns: number;
  status: 'pass' | 'blocked';
}

export function attestArenaTraceRuns(input: {
  projectRoot: string;
  claims: ArenaTraceRunClaim[];
  tracePaths: string[];
  outputContract?: ArenaTraceOutputContract;
}): ArenaTraceSessionAttestation[] {
  const traceCandidates = input.tracePaths.map(tracePath => ({
    tracePath,
    error: tracePathError(input.projectRoot, path.resolve(tracePath)),
  }));
  const sessionCounts = new Map<string, number>();
  for (const claim of input.claims) {
    const sessionKey = claim.sessionKey?.trim();
    if (sessionKey) sessionCounts.set(sessionKey, (sessionCounts.get(sessionKey) || 0) + 1);
  }

  const sessions = input.claims.map(claim => {
    const sessionKey = claim.sessionKey?.trim();
    if (claim.blockedReason) return blockedAttestation(claim, claim.blockedReason);
    if (!sessionKey) {
      return blockedAttestation(claim, 'run did not record a non-empty session_key for native trace binding');
    }
    if ((sessionCounts.get(sessionKey) || 0) !== 1) {
      return blockedAttestation(claim, `native trace session ${sessionKey} is reused by multiple runs`);
    }
    const matchingTracePaths = traceCandidates
      .filter(candidate => !candidate.error && traceContainsSession(candidate.tracePath, sessionKey))
      .map(candidate => candidate.tracePath);
    if (matchingTracePaths.length !== 1) {
      const rejected = traceCandidates
        .filter(candidate => candidate.error)
        .map(candidate => candidate.error)
        .join('; ');
      return blockedAttestation(
        claim,
        [
          `expected exactly one native trace for session ${sessionKey}; found ${matchingTracePaths.length}`,
          rejected && `rejected unsafe trace evidence: ${rejected}`,
        ].filter(Boolean).join('; '),
      );
    }
    return attestArenaTrace({
      projectRoot: input.projectRoot,
      claim: { ...claim, sessionKey },
      tracePath: matchingTracePaths[0],
      outputContract: input.outputContract,
    });
  });

  return enforceGlobalTraceIdUniqueness(sessions);
}

export function enforceGlobalTraceIdUniqueness(
  sessions: ArenaTraceSessionAttestation[],
): ArenaTraceSessionAttestation[] {
  const ownersByTraceId = new Map<string, Set<number>>();
  for (const [sessionIndex, session] of sessions.entries()) {
    if (!session.tracePath) continue;
    for (const traceId of readTraceIds(session.tracePath)) {
      const owners = ownersByTraceId.get(traceId) || new Set<number>();
      owners.add(sessionIndex);
      ownersByTraceId.set(traceId, owners);
    }
  }
  const duplicateReasons = new Map<number, string[]>();
  for (const [traceId, owners] of ownersByTraceId.entries()) {
    if (owners.size < 2) continue;
    for (const owner of owners) {
      const reasons = duplicateReasons.get(owner) || [];
      reasons.push(`native trace_id ${traceId} is reused across multiple claimed sessions`);
      duplicateReasons.set(owner, reasons);
    }
  }
  return sessions.map((session, index) => {
    const reasons = duplicateReasons.get(index);
    if (!reasons?.length) return session;
    const identityBlockedReasons = Array.from(new Set([...session.identityBlockedReasons, ...reasons]));
    const blockedReasons = [...identityBlockedReasons, ...session.contractBlockedReasons];
    return {
      ...session,
      identityBlockedReasons,
      blockedReasons,
      identityStatus: 'blocked' as const,
      status: 'blocked' as const,
    };
  });
}

export function attestArenaTrace(input: {
  projectRoot: string;
  claim: ArenaTraceRunClaim;
  tracePath: string;
  outputContract?: ArenaTraceOutputContract;
}): ArenaTraceSessionAttestation {
  const sessionKey = input.claim.sessionKey?.trim();
  const tracePath = path.resolve(input.tracePath);
  const traceRef = relativeRef(input.projectRoot, tracePath);
  const identityBlockedReasons: string[] = [];
  const contractBlockedReasons: string[] = [];
  if (!sessionKey) identityBlockedReasons.push('run did not record a non-empty session_key for native trace binding');
  if (!Number.isInteger(input.claim.expectedTurns) || input.claim.expectedTurns <= 0) {
    identityBlockedReasons.push(`expected_turns must be a positive integer; got ${input.claim.expectedTurns}`);
  }
  const safePathError = tracePathError(input.projectRoot, tracePath);
  if (safePathError) {
    identityBlockedReasons.push(safePathError);
    return buildAttestation(
      input.claim,
      tracePath,
      traceRef,
      [],
      [],
      identityBlockedReasons,
      contractBlockedReasons,
    );
  }

  const rows: Record<string, unknown>[] = [];
  for (const [lineIndex, line] of fs.readFileSync(tracePath, 'utf-8').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (!isRecord(parsed)) {
        identityBlockedReasons.push(`trace line ${lineIndex + 1} is not an object`);
      } else if (parsed.entry_type === 'trace') {
        rows.push(parsed);
      }
    } catch (error) {
      identityBlockedReasons.push(`trace line ${lineIndex + 1} is invalid JSON (${errorMessage(error)})`);
    }
  }

  if (rows.length !== input.claim.expectedTurns) {
    identityBlockedReasons.push(`turn coverage mismatch: expected ${input.claim.expectedTurns}, checked ${rows.length}`);
  }
  if (sessionKey && rows.some(row => String(row.session_id || '') !== sessionKey)) {
    identityBlockedReasons.push(`native trace contains rows outside session ${sessionKey}`);
  }
  const traceIds = rows.map(row => typeof row.trace_id === 'string' ? row.trace_id.trim() : '');
  if (traceIds.some(traceId => !traceId) || new Set(traceIds).size !== traceIds.length) {
    identityBlockedReasons.push('native trace rows must have unique non-empty trace_id values');
  }
  const explicitTurns = rows.map(row => Number(row.turn));
  if (explicitTurns.some(turn => !Number.isInteger(turn) || turn <= 0)) {
    identityBlockedReasons.push('native trace rows must have explicit positive integer turn values');
  } else {
    const observedTurns = [...explicitTurns].sort((left, right) => left - right);
    const expectedTurns = Array.from({ length: input.claim.expectedTurns }, (_, index) => index + 1);
    if (
      observedTurns.length !== expectedTurns.length
      || observedTurns.some((turn, index) => turn !== expectedTurns[index])
    ) {
      identityBlockedReasons.push(`native trace turn coverage must be exactly 1..${input.claim.expectedTurns}`);
    }
  }

  const violations: ArenaTraceTurnViolation[] = [];
  let passedTurns = 0;
  for (const [index, row] of rows.entries()) {
    const result = input.outputContract
      ? checkOutputContractTurn(row, input.outputContract)
      : { violationReasons: [], blockedReasons: [] };
    if (result.blockedReasons.length > 0) {
      contractBlockedReasons.push(...result.blockedReasons.map(reason => `turn ${readTraceTurn(row, index)}: ${reason}`));
    }
    if (result.violationReasons.length > 0) {
      violations.push({
        turn: readTraceTurn(row, index),
        traceId: String(row.trace_id || `trace-line-${index + 1}`),
        reasons: result.violationReasons,
      });
    } else if (result.blockedReasons.length === 0) {
      passedTurns += 1;
    }
  }
  return buildAttestation(
    input.claim,
    tracePath,
    traceRef,
    rows,
    violations,
    identityBlockedReasons,
    contractBlockedReasons,
    passedTurns,
  );
}

export function summarizeArenaTraceIdentity(
  sessions: ArenaTraceSessionAttestation[],
): ArenaTraceIdentityCheck {
  const expectedTurns = sessions.reduce((sum, session) => sum + session.expectedTurns, 0);
  const checkedTurns = sessions.reduce((sum, session) => sum + session.checkedTurns, 0);
  const verifiedSessions = sessions.filter(session => session.identityStatus === 'pass').length;
  const blocked = sessions.length === 0
    || expectedTurns <= 0
    || checkedTurns !== expectedTurns
    || sessions.some(session => session.identityStatus === 'blocked');
  return {
    expected_sessions: sessions.length,
    verified_sessions: verifiedSessions,
    expected_turns: expectedTurns,
    checked_turns: checkedTurns,
    status: blocked ? 'blocked' : 'pass',
  };
}

export function summarizeArenaOutputContract(input: {
  declared: boolean;
  sourceRef: string | null;
  sessions: ArenaTraceSessionAttestation[];
  totalSessions?: number;
}): ArenaOutputContractCheck {
  if (!input.declared) {
    return {
      declared: false,
      source_ref: null,
      expected_turns: 0,
      checked_turns: 0,
      passed_turns: 0,
      violation_count: 0,
      fully_compliant_sessions: 0,
      total_sessions: input.totalSessions ?? input.sessions.length,
      status: 'not_declared',
    };
  }
  const expectedTurns = input.sessions.reduce((sum, session) => sum + session.expectedTurns, 0);
  const checkedTurns = input.sessions.reduce((sum, session) => sum + session.checkedTurns, 0);
  const passedTurns = input.sessions.reduce((sum, session) => sum + session.passedTurns, 0);
  const violationCount = input.sessions.reduce((sum, session) => sum + session.violations.length, 0);
  const fullyCompliantSessions = input.sessions.filter(session => session.status === 'pass').length;
  const blocked = input.sessions.length === 0
    || expectedTurns <= 0
    || expectedTurns !== checkedTurns
    || input.sessions.some(session => session.status === 'blocked');
  return {
    declared: true,
    source_ref: input.sourceRef,
    expected_turns: expectedTurns,
    checked_turns: checkedTurns,
    passed_turns: passedTurns,
    violation_count: violationCount,
    fully_compliant_sessions: fullyCompliantSessions,
    total_sessions: input.sessions.length,
    status: blocked ? 'blocked' : violationCount > 0 ? 'fail' : 'pass',
  };
}

function checkOutputContractTurn(
  row: Record<string, unknown>,
  contract: ArenaTraceOutputContract,
): { violationReasons: string[]; blockedReasons: string[] } {
  const assistant = isRecord(row.assistant) ? row.assistant : {};
  const toolCalls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls.filter(isRecord) : [];
  const sendTextCalls = toolCalls.filter(call => String(call.name || '') === 'send_text');
  const violationReasons: string[] = [];
  const blockedReasons: string[] = [];
  if (typeof assistant.text === 'string' && assistant.text.trim()) {
    violationReasons.push('unexpected assistant text outside the send_text delivery');
  }

  const toolVisibility = Array.isArray(row.tool_visibility) ? row.tool_visibility : [];
  const latestVisibilityValue = toolVisibility[toolVisibility.length - 1];
  const latestVisibility = isRecord(latestVisibilityValue) ? latestVisibilityValue : undefined;
  const activeSkillName = latestVisibility && typeof latestVisibility.activeSkillName === 'string'
    ? latestVisibility.activeSkillName.trim()
    : '';
  if (!contract.subjectSkillId) {
    blockedReasons.push('declared output contract is not bound to a subject skill');
  } else if (!latestVisibility) {
    blockedReasons.push(`missing final tool_visibility for subject skill ${contract.subjectSkillId}`);
  } else if (activeSkillName !== contract.subjectSkillId) {
    blockedReasons.push(
      `final tool_visibility.activeSkillName must be ${contract.subjectSkillId}; observed ${activeSkillName || 'missing'}`,
    );
  }

  if (sendTextCalls.length !== 1) {
    violationReasons.push(`expected exactly one send_text delivery; observed ${sendTextCalls.length}`);
    return { violationReasons, blockedReasons };
  }
  const call = sendTextCalls[0];
  if (String(call.status || '').toLowerCase() !== 'success') {
    violationReasons.push(`send_text did not succeed (status=${String(call.status || 'missing')})`);
    return { violationReasons, blockedReasons };
  }
  const deliveryEvidence = Array.isArray(call.delivery_evidence) ? call.delivery_evidence.filter(isRecord) : [];
  const deliveredTextEvidence = deliveryEvidence.filter(item => (
    item.delivery_type === 'text' && item.status === 'delivered'
  ));
  if (deliveredTextEvidence.length === 0) {
    blockedReasons.push('missing delivered text evidence record');
  } else if (deliveredTextEvidence.length > 1) {
    violationReasons.push(`expected exactly one delivered text evidence record; observed ${deliveredTextEvidence.length}`);
  }
  const outputText = readSendTextArgument(call.arguments);
  if (!outputText) blockedReasons.push('send_text arguments.text is missing or empty');
  if (!outputText || blockedReasons.length > 0) return { violationReasons, blockedReasons };

  const lines = outputText.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length !== contract.linePrefixes.length) {
    violationReasons.push(`expected exactly ${contract.linePrefixes.length} output lines; observed ${lines.length}`);
    return { violationReasons, blockedReasons };
  }
  for (const [index, prefix] of contract.linePrefixes.entries()) {
    const line = lines[index];
    if (!line.startsWith(prefix)) {
      violationReasons.push(`line ${index + 1} must start with ${prefix}`);
    } else if (!line.slice(prefix.length).trim()) {
      violationReasons.push(`line ${index + 1} must contain text after ${prefix}`);
    }
  }
  return { violationReasons, blockedReasons };
}

function buildAttestation(
  claim: ArenaTraceRunClaim,
  tracePath: string,
  traceRef: string,
  rows: Record<string, unknown>[],
  violations: ArenaTraceTurnViolation[],
  identityBlockedReasons: string[],
  contractBlockedReasons: string[],
  passedTurns = 0,
): ArenaTraceSessionAttestation {
  const blockedReasons = [...identityBlockedReasons, ...contractBlockedReasons];
  return {
    runId: claim.runId,
    ...(claim.sessionKey?.trim() && { sessionKey: claim.sessionKey.trim() }),
    tracePath,
    traceRef,
    expectedTurns: claim.expectedTurns,
    checkedTurns: rows.length,
    passedTurns,
    violations,
    identityBlockedReasons,
    contractBlockedReasons,
    blockedReasons,
    identityStatus: identityBlockedReasons.length > 0 ? 'blocked' : 'pass',
    status: blockedReasons.length > 0 ? 'blocked' : violations.length > 0 ? 'fail' : 'pass',
  };
}

function blockedAttestation(
  claim: ArenaTraceRunClaim,
  reason: string,
): ArenaTraceSessionAttestation {
  return {
    runId: claim.runId,
    ...(claim.sessionKey?.trim() && { sessionKey: claim.sessionKey.trim() }),
    expectedTurns: claim.expectedTurns,
    checkedTurns: 0,
    passedTurns: 0,
    violations: [],
    identityBlockedReasons: [reason],
    contractBlockedReasons: [],
    blockedReasons: [reason],
    identityStatus: 'blocked',
    status: 'blocked',
  };
}

function traceContainsSession(tracePath: string, sessionKey: string): boolean {
  if (!sessionKey || !fs.existsSync(tracePath)) return false;
  for (const line of fs.readFileSync(tracePath, 'utf-8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (isRecord(row) && row.entry_type === 'trace' && row.session_id === sessionKey) return true;
    } catch {
      // The selected trace is parsed strictly by attestArenaTrace.
    }
  }
  return false;
}

function readTraceIds(tracePath: string): string[] {
  const traceIds: string[] = [];
  for (const line of fs.readFileSync(tracePath, 'utf-8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (isRecord(row) && row.entry_type === 'trace' && typeof row.trace_id === 'string' && row.trace_id.trim()) {
        traceIds.push(row.trace_id.trim());
      }
    } catch {
      // attestArenaTrace reports malformed rows on the owning session.
    }
  }
  return traceIds;
}

function tracePathError(projectRoot: string, tracePath: string): string | undefined {
  const root = path.resolve(projectRoot);
  const relative = path.relative(root, tracePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return 'native trace escapes the project root';
  if (!fs.existsSync(tracePath)) return `native trace does not exist: ${tracePath}`;
  if (fs.lstatSync(tracePath).isSymbolicLink()) return `native trace cannot be a symlink: ${tracePath}`;
  if (!fs.statSync(tracePath).isFile()) return `native trace must be a regular file: ${tracePath}`;
  const realRoot = fs.realpathSync(root);
  const realTrace = fs.realpathSync(tracePath);
  const realRelative = path.relative(realRoot, realTrace);
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) return 'native trace real path escapes the project root';
  return undefined;
}

function readSendTextArgument(value: unknown): string {
  if (isRecord(value) && typeof value.text === 'string') return value.text;
  if (typeof value !== 'string') return '';
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) && typeof parsed.text === 'string' ? parsed.text : '';
  } catch {
    return '';
  }
}

function readTraceTurn(row: Record<string, unknown>, fallbackIndex: number): number {
  const value = Number(row.turn);
  return Number.isInteger(value) && value > 0 ? value : fallbackIndex + 1;
}

function relativeRef(root: string, filePath: string): string {
  return path.relative(path.resolve(root), path.resolve(filePath)).replace(/\\/g, '/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
