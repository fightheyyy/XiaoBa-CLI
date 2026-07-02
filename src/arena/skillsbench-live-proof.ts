import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  CatEffectivenessObservedCase,
  CatEffectivenessObservedRun,
  CatEffectivenessVerifierResult,
  writeCatEffectivenessScorecard,
} from './cat-effectiveness';
import {
  ArenaEffectivenessObservedRun,
  ArenaEffectivenessVerifierResult,
  writeArenaEffectivenessScorecard,
} from './arena-effectiveness';
import { ArenaDecision } from './types';
import { PathResolver } from '../utils/path-resolver';

const OFFER_LETTER_CASE_ID = 'skillsbench.offer-letter-generator.v1';
const CITATION_CHECK_CASE_ID = 'skillsbench.citation-check.v1';
const SOFTWARE_DEPENDENCY_AUDIT_CASE_ID = 'skillsbench.software-dependency-audit.v1';
const LAB_UNIT_HARMONIZATION_CASE_ID = 'skillsbench.lab-unit-harmonization.v1';
const DIALOGUE_PARSER_CASE_ID = 'skillsbench.dialogue-parser.v1';
const SALES_PIVOT_ANALYSIS_CASE_ID = 'skillsbench.sales-pivot-analysis.v1';
const XLSX_RECOVER_DATA_CASE_ID = 'skillsbench.xlsx-recover-data.v1';
const DEFAULT_VERIFIER_TIMEOUT_MS = 300_000;

export interface SkillsBenchOfferLetterVerifierInput {
  projectRoot?: string;
  runId: string;
  caseId?: string;
  timeoutMs?: number;
}

export interface SkillsBenchLiveProofInput extends SkillsBenchOfferLetterVerifierInput {
  verifierResultsPath?: string;
}

export interface SkillsBenchVerifierArtifact {
  version: 1;
  verifier_type: string;
  case_id: string;
  run_id: string;
  status: 'pass' | 'fail' | 'blocked' | 'unsafe';
  results: Array<CatEffectivenessVerifierResult & ArenaEffectivenessVerifierResult>;
  workspace_root: string;
  output_file: string;
  data_file: string;
  artifact_refs: string[];
  evidence_refs: string[];
  message: string;
  generated_at: string;
}

export interface SkillsBenchLiveProofResult {
  run_id: string;
  case_id: string;
  verifier_results_path: string;
  cat_effectiveness_scorecard_path: string;
  arena_effectiveness_scorecard_path: string;
  cat_effectiveness_decision: string;
  arena_effectiveness_decision: string;
}

export function runSkillsBenchVerifier(
  input: SkillsBenchOfferLetterVerifierInput,
): SkillsBenchVerifierArtifact {
  const caseId = input.caseId || OFFER_LETTER_CASE_ID;
  if (caseId === OFFER_LETTER_CASE_ID) {
    return runSkillsBenchOfferLetterVerifier(input);
  }
  if (caseId === CITATION_CHECK_CASE_ID) {
    return runSkillsBenchCitationCheckVerifier(input);
  }
  const genericConfig = genericVerifierConfig(caseId);
  if (genericConfig) {
    return runSkillsBenchGenericPytestVerifier(input, genericConfig);
  }
  throw new Error(`Unsupported SkillsBench live verifier case: ${caseId}`);
}

export function runSkillsBenchOfferLetterVerifier(
  input: SkillsBenchOfferLetterVerifierInput,
): SkillsBenchVerifierArtifact {
  const projectRoot = path.resolve(input.projectRoot || PathResolver.getProjectRoot());
  const caseId = input.caseId || OFFER_LETTER_CASE_ID;
  if (caseId !== OFFER_LETTER_CASE_ID) {
    throw new Error(`Unsupported SkillsBench live verifier case: ${caseId}`);
  }
  const runRoot = path.join(projectRoot, 'arena', 'runs', safeSegment(input.runId));
  const runtimePath = path.join(runRoot, 'clean-runtime.json');
  const workspaceRoot = fs.existsSync(runtimePath)
    ? String(readJson(runtimePath).roots?.workspace_root || path.join(runRoot, 'workspace'))
    : path.join(runRoot, 'workspace');
  const proofVerifierRoot = path.join(proofRunRoot(projectRoot, input.runId), 'verifier');
  fs.mkdirSync(proofVerifierRoot, { recursive: true });

  const caseRoot = caseRootFor(projectRoot, caseId);
  const sourceVerifier = path.join(caseRoot, 'verifier', 'test_outputs.py');
  const outputFile = path.join(workspaceRoot, 'offer_letter_filled.docx');
  const dataFile = path.join(workspaceRoot, 'employee_data.json');
  const templateFile = path.join(workspaceRoot, 'offer_letter_template.docx');
  const verifierResultsPath = path.join(proofVerifierRoot, 'verifier-results.json');
  const stdoutPath = path.join(proofVerifierRoot, 'pytest.stdout.log');
  const stderrPath = path.join(proofVerifierRoot, 'pytest.stderr.log');
  const ctrfPath = path.join(proofVerifierRoot, 'ctrf.json');
  const patchedVerifierPath = path.join(proofVerifierRoot, 'test_outputs_arena.py');

  let status: SkillsBenchVerifierArtifact['status'] = 'blocked';
  let message = '';
  const evidenceRefs = [relativeRef(projectRoot, verifierResultsPath)];

  if (!fs.existsSync(dataFile) || !fs.existsSync(templateFile)) {
    status = 'blocked';
    message = 'SkillsBench workspace fixtures are missing from the clean Arena workspace.';
  } else if (!fs.existsSync(outputFile)) {
    status = 'fail';
    message = 'Output file not found: offer_letter_filled.docx';
  } else if (!fs.existsSync(sourceVerifier)) {
    status = 'blocked';
    message = 'Materialized SkillsBench verifier file is missing.';
  } else if (!commandExists('uvx')) {
    status = 'blocked';
    message = 'uvx is required to run the hidden SkillsBench pytest verifier with python-docx.';
  } else {
    const patchedVerifier = fs.readFileSync(sourceVerifier, 'utf-8')
      .replace('OUTPUT_FILE = "/root/offer_letter_filled.docx"', `OUTPUT_FILE = ${JSON.stringify(outputFile)}`)
      .replace('DATA_FILE = "/root/employee_data.json"', `DATA_FILE = ${JSON.stringify(dataFile)}`);
    fs.writeFileSync(patchedVerifierPath, patchedVerifier, 'utf-8');

    const result = spawnSync('uvx', [
      '--with', 'pytest==8.4.1',
      '--with', 'pytest-json-ctrf==0.3.5',
      '--with', 'python-docx==1.1.2',
      'pytest',
      '--ctrf',
      ctrfPath,
      patchedVerifierPath,
      '-rA',
      '-v',
    ], {
      cwd: proofVerifierRoot,
      encoding: 'utf-8',
      timeout: input.timeoutMs || DEFAULT_VERIFIER_TIMEOUT_MS,
      env: process.env,
    });
    fs.writeFileSync(stdoutPath, result.stdout || '', 'utf-8');
    fs.writeFileSync(stderrPath, result.stderr || '', 'utf-8');
    evidenceRefs.push(relativeRef(projectRoot, stdoutPath), relativeRef(projectRoot, stderrPath));
    if (fs.existsSync(ctrfPath)) {
      evidenceRefs.push(relativeRef(projectRoot, ctrfPath));
    }
    if (result.error) {
      status = 'blocked';
      message = `Verifier runner failed: ${result.error.message}`;
    } else if (result.signal === 'SIGTERM') {
      status = 'blocked';
      message = 'Verifier runner timed out.';
    } else {
      status = result.status === 0 ? 'pass' : 'fail';
      message = result.status === 0
        ? 'SkillsBench offer-letter verifier passed.'
        : `SkillsBench offer-letter verifier failed with exit status ${result.status}.`;
    }
  }

  const artifactRefs = findWorkspaceDocxArtifacts(projectRoot, workspaceRoot);
  const artifact: SkillsBenchVerifierArtifact = {
    version: 1,
    verifier_type: 'skillsbench_offer_letter',
    case_id: caseId,
    run_id: input.runId,
    status,
    results: [{
      status,
      ref: relativeRef(projectRoot, verifierResultsPath),
      message,
    }],
    workspace_root: workspaceRoot,
    output_file: outputFile,
    data_file: dataFile,
    artifact_refs: artifactRefs,
    evidence_refs: evidenceRefs,
    message,
    generated_at: new Date().toISOString(),
  };
  writeJson(verifierResultsPath, artifact);
  return artifact;
}

export function runSkillsBenchCitationCheckVerifier(
  input: SkillsBenchOfferLetterVerifierInput,
): SkillsBenchVerifierArtifact {
  const projectRoot = path.resolve(input.projectRoot || PathResolver.getProjectRoot());
  const caseId = input.caseId || CITATION_CHECK_CASE_ID;
  if (caseId !== CITATION_CHECK_CASE_ID) {
    throw new Error(`Unsupported SkillsBench citation verifier case: ${caseId}`);
  }
  const runRoot = path.join(projectRoot, 'arena', 'runs', safeSegment(input.runId));
  const runtimePath = path.join(runRoot, 'clean-runtime.json');
  const workspaceRoot = fs.existsSync(runtimePath)
    ? String(readJson(runtimePath).roots?.workspace_root || path.join(runRoot, 'workspace'))
    : path.join(runRoot, 'workspace');
  const proofVerifierRoot = path.join(proofRunRoot(projectRoot, input.runId), 'verifier');
  fs.mkdirSync(proofVerifierRoot, { recursive: true });

  const caseRoot = caseRootFor(projectRoot, caseId);
  const sourceVerifier = path.join(caseRoot, 'verifier', 'test_outputs.py');
  const outputFile = path.join(workspaceRoot, 'answer.json');
  const dataFile = path.join(workspaceRoot, 'test.bib');
  const verifierResultsPath = path.join(proofVerifierRoot, 'verifier-results.json');
  const stdoutPath = path.join(proofVerifierRoot, 'pytest.stdout.log');
  const stderrPath = path.join(proofVerifierRoot, 'pytest.stderr.log');
  const ctrfPath = path.join(proofVerifierRoot, 'ctrf.json');
  const patchedVerifierPath = path.join(proofVerifierRoot, 'test_outputs_arena.py');

  let status: SkillsBenchVerifierArtifact['status'] = 'blocked';
  let message = '';
  const evidenceRefs = [relativeRef(projectRoot, verifierResultsPath)];

  if (!fs.existsSync(dataFile)) {
    status = 'blocked';
    message = 'SkillsBench citation workspace fixture is missing from the clean Arena workspace.';
  } else if (!fs.existsSync(outputFile)) {
    status = 'fail';
    message = 'Output file not found: answer.json';
  } else if (!fs.existsSync(sourceVerifier)) {
    status = 'blocked';
    message = 'Materialized SkillsBench citation verifier file is missing.';
  } else if (!commandExists('uvx')) {
    status = 'blocked';
    message = 'uvx is required to run the hidden SkillsBench pytest verifier.';
  } else {
    const patchedVerifier = fs.readFileSync(sourceVerifier, 'utf-8')
      .replace('ANSWER_FILE = Path("/root/answer.json")', `ANSWER_FILE = Path(${JSON.stringify(outputFile)})`);
    fs.writeFileSync(patchedVerifierPath, patchedVerifier, 'utf-8');

    const result = spawnSync('uvx', [
      '--with', 'pytest==8.4.1',
      '--with', 'pytest-json-ctrf==0.3.5',
      'pytest',
      '--ctrf',
      ctrfPath,
      patchedVerifierPath,
      '-rA',
      '-v',
    ], {
      cwd: proofVerifierRoot,
      encoding: 'utf-8',
      timeout: input.timeoutMs || DEFAULT_VERIFIER_TIMEOUT_MS,
      env: process.env,
    });
    fs.writeFileSync(stdoutPath, result.stdout || '', 'utf-8');
    fs.writeFileSync(stderrPath, result.stderr || '', 'utf-8');
    evidenceRefs.push(relativeRef(projectRoot, stdoutPath), relativeRef(projectRoot, stderrPath));
    if (fs.existsSync(ctrfPath)) {
      evidenceRefs.push(relativeRef(projectRoot, ctrfPath));
    }
    if (result.error) {
      status = 'blocked';
      message = `Verifier runner failed: ${result.error.message}`;
    } else if (result.signal === 'SIGTERM') {
      status = 'blocked';
      message = 'Verifier runner timed out.';
    } else {
      status = result.status === 0 ? 'pass' : 'fail';
      message = result.status === 0
        ? 'SkillsBench citation-check verifier passed.'
        : `SkillsBench citation-check verifier failed with exit status ${result.status}.`;
    }
  }

  const artifactRefs = [
    ...(fs.existsSync(outputFile) ? [relativeRef(projectRoot, outputFile)] : []),
    ...(fs.existsSync(dataFile) ? [relativeRef(projectRoot, dataFile)] : []),
  ];
  const artifact: SkillsBenchVerifierArtifact = {
    version: 1,
    verifier_type: 'skillsbench_citation_check',
    case_id: caseId,
    run_id: input.runId,
    status,
    results: [{
      status,
      ref: relativeRef(projectRoot, verifierResultsPath),
      message,
    }],
    workspace_root: workspaceRoot,
    output_file: outputFile,
    data_file: dataFile,
    artifact_refs: artifactRefs,
    evidence_refs: evidenceRefs,
    message,
    generated_at: new Date().toISOString(),
  };
  writeJson(verifierResultsPath, artifact);
  return artifact;
}

interface SkillsBenchGenericVerifierConfig {
  case_id: string;
  verifier_type: string;
  output_files: string[];
  data_files: string[];
  pytest_packages: string[];
  replacements?: Array<[string, string]>;
  cwd?: 'workspace' | 'proof';
}

function genericVerifierConfig(caseId: string): SkillsBenchGenericVerifierConfig | undefined {
  if (caseId === SOFTWARE_DEPENDENCY_AUDIT_CASE_ID) {
    return {
      case_id: caseId,
      verifier_type: 'skillsbench_software_dependency_audit',
      output_files: ['security_audit.csv'],
      data_files: ['package-lock.json'],
      pytest_packages: [],
      cwd: 'workspace',
    };
  }
  if (caseId === LAB_UNIT_HARMONIZATION_CASE_ID) {
    return {
      case_id: caseId,
      verifier_type: 'skillsbench_lab_unit_harmonization',
      output_files: ['ckd_lab_data_harmonized.csv'],
      data_files: ['data/ckd_lab_data.csv', 'data/ckd_feature_descriptions.csv'],
      pytest_packages: ['pandas==2.3.3', 'numpy==2.3.5'],
      replacements: [
        ['HARMONIZED_FILE = "/root/ckd_lab_data_harmonized.csv"', 'HARMONIZED_FILE = "__ARENA_WORKSPACE__/ckd_lab_data_harmonized.csv"'],
      ],
      cwd: 'workspace',
    };
  }
  if (caseId === DIALOGUE_PARSER_CASE_ID) {
    return {
      case_id: caseId,
      verifier_type: 'skillsbench_dialogue_parser',
      output_files: ['dialogue.json', 'dialogue.dot'],
      data_files: ['script.txt'],
      pytest_packages: [],
      cwd: 'workspace',
    };
  }
  if (caseId === SALES_PIVOT_ANALYSIS_CASE_ID) {
    return {
      case_id: caseId,
      verifier_type: 'skillsbench_sales_pivot_analysis',
      output_files: ['demographic_analysis.xlsx'],
      data_files: ['income.xlsx', 'population.pdf'],
      pytest_packages: ['openpyxl==3.1.5', 'pandas==2.3.3'],
      replacements: [
        ['OUTPUT_FILE = "/root/demographic_analysis.xlsx"', 'OUTPUT_FILE = "__ARENA_WORKSPACE__/demographic_analysis.xlsx"'],
        ['POPULATION_PDF = "/root/population.pdf"', 'POPULATION_PDF = "__ARENA_WORKSPACE__/population.pdf"'],
        ['INCOME_XLSX = "/root/income.xlsx"', 'INCOME_XLSX = "__ARENA_WORKSPACE__/income.xlsx"'],
      ],
      cwd: 'workspace',
    };
  }
  if (caseId === XLSX_RECOVER_DATA_CASE_ID) {
    return {
      case_id: caseId,
      verifier_type: 'skillsbench_xlsx_recover_data',
      output_files: ['nasa_budget_recovered.xlsx'],
      data_files: ['nasa_budget_incomplete.xlsx'],
      pytest_packages: ['openpyxl==3.1.5'],
      cwd: 'workspace',
    };
  }
  return undefined;
}

function runSkillsBenchGenericPytestVerifier(
  input: SkillsBenchOfferLetterVerifierInput,
  config: SkillsBenchGenericVerifierConfig,
): SkillsBenchVerifierArtifact {
  const projectRoot = path.resolve(input.projectRoot || PathResolver.getProjectRoot());
  const caseId = input.caseId || config.case_id;
  const runRoot = path.join(projectRoot, 'arena', 'runs', safeSegment(input.runId));
  const runtimePath = path.join(runRoot, 'clean-runtime.json');
  const workspaceRoot = fs.existsSync(runtimePath)
    ? String(readJson(runtimePath).roots?.workspace_root || path.join(runRoot, 'workspace'))
    : path.join(runRoot, 'workspace');
  const proofVerifierRoot = path.join(proofRunRoot(projectRoot, input.runId), 'verifier');
  fs.mkdirSync(proofVerifierRoot, { recursive: true });

  const caseRoot = caseRootFor(projectRoot, caseId);
  const sourceVerifier = path.join(caseRoot, 'verifier', 'test_outputs.py');
  const verifierResultsPath = path.join(proofVerifierRoot, 'verifier-results.json');
  const stdoutPath = path.join(proofVerifierRoot, 'pytest.stdout.log');
  const stderrPath = path.join(proofVerifierRoot, 'pytest.stderr.log');
  const ctrfPath = path.join(proofVerifierRoot, 'ctrf.json');
  const patchedVerifierPath = path.join(proofVerifierRoot, 'test_outputs_arena.py');
  const outputFiles = config.output_files.map(item => path.join(workspaceRoot, item));
  const dataFiles = config.data_files.map(item => path.join(workspaceRoot, item));

  let status: SkillsBenchVerifierArtifact['status'] = 'blocked';
  let message = '';
  const evidenceRefs = [relativeRef(projectRoot, verifierResultsPath)];
  const missingData = dataFiles.filter(filePath => !fs.existsSync(filePath));
  const missingOutputs = outputFiles.filter(filePath => !fs.existsSync(filePath));

  if (missingData.length > 0) {
    status = 'blocked';
    message = `SkillsBench workspace fixtures are missing from the clean Arena workspace: ${missingData.map(filePath => path.basename(filePath)).join(', ')}`;
  } else if (missingOutputs.length > 0) {
    status = 'fail';
    message = `Output file(s) not found: ${missingOutputs.map(filePath => path.basename(filePath)).join(', ')}`;
  } else if (!fs.existsSync(sourceVerifier)) {
    status = 'blocked';
    message = 'Materialized SkillsBench verifier file is missing.';
  } else if (!commandExists('uvx')) {
    status = 'blocked';
    message = 'uvx is required to run the hidden SkillsBench pytest verifier.';
  } else {
    let patchedVerifier = fs.readFileSync(sourceVerifier, 'utf-8');
    for (const [needle, replacement] of config.replacements || []) {
      patchedVerifier = patchedVerifier.replace(needle, replacement.split('__ARENA_WORKSPACE__').join(workspaceRoot));
    }
    fs.writeFileSync(patchedVerifierPath, patchedVerifier, 'utf-8');

    const result = spawnSync('uvx', [
      '--with', 'pytest==8.4.1',
      '--with', 'pytest-json-ctrf==0.3.5',
      ...config.pytest_packages.flatMap(packageName => ['--with', packageName]),
      'pytest',
      '--ctrf',
      ctrfPath,
      patchedVerifierPath,
      '-rA',
      '-v',
    ], {
      cwd: config.cwd === 'proof' ? proofVerifierRoot : workspaceRoot,
      encoding: 'utf-8',
      timeout: input.timeoutMs || DEFAULT_VERIFIER_TIMEOUT_MS,
      env: process.env,
    });
    fs.writeFileSync(stdoutPath, result.stdout || '', 'utf-8');
    fs.writeFileSync(stderrPath, result.stderr || '', 'utf-8');
    evidenceRefs.push(relativeRef(projectRoot, stdoutPath), relativeRef(projectRoot, stderrPath));
    if (fs.existsSync(ctrfPath)) {
      evidenceRefs.push(relativeRef(projectRoot, ctrfPath));
    }
    if (result.error) {
      status = 'blocked';
      message = `Verifier runner failed: ${result.error.message}`;
    } else if (result.signal === 'SIGTERM') {
      status = 'blocked';
      message = 'Verifier runner timed out.';
    } else {
      status = result.status === 0 ? 'pass' : 'fail';
      message = result.status === 0
        ? `SkillsBench ${caseId} verifier passed.`
        : `SkillsBench ${caseId} verifier failed with exit status ${result.status}.`;
    }
  }

  const artifactRefs = uniqueStrings([
    ...outputFiles.filter(fs.existsSync).map(filePath => relativeRef(projectRoot, filePath)),
    ...dataFiles.filter(fs.existsSync).map(filePath => relativeRef(projectRoot, filePath)),
  ]);
  const artifact: SkillsBenchVerifierArtifact = {
    version: 1,
    verifier_type: config.verifier_type,
    case_id: caseId,
    run_id: input.runId,
    status,
    results: [{
      status,
      ref: relativeRef(projectRoot, verifierResultsPath),
      message,
    }],
    workspace_root: workspaceRoot,
    output_file: outputFiles[0] || '',
    data_file: dataFiles[0] || '',
    artifact_refs: artifactRefs,
    evidence_refs: evidenceRefs,
    message,
    generated_at: new Date().toISOString(),
  };
  writeJson(verifierResultsPath, artifact);
  return artifact;
}

export function writeSkillsBenchLiveProofScorecards(
  input: SkillsBenchLiveProofInput,
): SkillsBenchLiveProofResult {
  const projectRoot = path.resolve(input.projectRoot || PathResolver.getProjectRoot());
  const caseId = input.caseId || OFFER_LETTER_CASE_ID;
  const verifier = input.verifierResultsPath
    ? readJson(path.resolve(projectRoot, input.verifierResultsPath)) as SkillsBenchVerifierArtifact
    : runSkillsBenchVerifier({ ...input, projectRoot, caseId });
  const outputRoot = proofRunRoot(projectRoot, input.runId);
  const verifierResultsPath = input.verifierResultsPath
    ? path.resolve(projectRoot, input.verifierResultsPath)
    : path.join(outputRoot, 'verifier', 'verifier-results.json');
  const catScorecardPath = path.join(outputRoot, 'cat-effectiveness-scorecard.json');
  const arenaScorecardPath = path.join(outputRoot, 'arena-effectiveness-scorecard.json');
  const catScorecard = writeCatEffectivenessScorecard(
    buildCatEffectivenessObservedRunFromArenaArtifacts({
      projectRoot,
      caseId,
      runId: input.runId,
      verifier,
      verifierResultsPath,
    }),
    catScorecardPath,
    { projectRoot },
  );
  const arenaScorecard = writeArenaEffectivenessScorecard(
    buildArenaEffectivenessObservedRunFromArenaArtifacts({
      projectRoot,
      caseId,
      runId: input.runId,
      verifier,
      verifierResultsPath,
    }),
    arenaScorecardPath,
    { projectRoot },
  );
  return {
    run_id: input.runId,
    case_id: caseId,
    verifier_results_path: catScorecard.reviewer.evidence_refs.find(ref => ref.endsWith('verifier-results.json'))
      || relativeRef(projectRoot, verifierResultsPath),
    cat_effectiveness_scorecard_path: relativeRef(projectRoot, catScorecardPath),
    arena_effectiveness_scorecard_path: relativeRef(projectRoot, arenaScorecardPath),
    cat_effectiveness_decision: catScorecard.overall.decision,
    arena_effectiveness_decision: arenaScorecard.overall.decision,
  };
}

export function buildCatEffectivenessObservedRunFromArenaArtifacts(input: {
  projectRoot?: string;
  caseId: string;
  runId: string;
  verifier: SkillsBenchVerifierArtifact;
  verifierResultsPath: string;
}): CatEffectivenessObservedRun {
  const projectRoot = path.resolve(input.projectRoot || PathResolver.getProjectRoot());
  const arenaScorecardPath = path.join(projectRoot, 'arena', 'runs', safeSegment(input.runId), 'arena-scorecard.json');
  const arenaScorecard = readJson(arenaScorecardPath);
  const traceRefs = readStringList(arenaScorecard.evidence?.trace_refs);
  const usercat = readPrimaryUserCatEvidence(projectRoot, arenaScorecard);
  const inspectorCases = readInspectorCases(projectRoot, arenaScorecard)
    .filter(item => item.issue_type !== 'no_issue_found');
  const replayTraceRefs = readStringList(arenaScorecard.replay_attempts?.trace_refs);
  return {
    run_id: input.runId,
    case_id: input.caseId,
    arena_run_ref: `arena/runs/${safeSegment(input.runId)}/arena-run.json`,
    usercat: {
      turn_count: usercat.turnCount,
      observed_behaviors: detectUserCatBehaviors(usercat.transcriptText, usercat.turnCount),
      transcript_text: usercat.transcriptText,
      observed_violations: detectUserCatViolations(usercat.transcriptText),
      evidence_refs: usercat.evidenceRefs,
    },
    inspector: {
      observed_cases: inspectorCases,
      clean_success_observed: input.verifier.results.every(result => result.status === 'pass'),
      evidence_refs: readInspectorEvidenceRefs(projectRoot, arenaScorecard),
    },
    reviewer: {
      decision: normalizeDecision(arenaScorecard.decision),
      verifier_results: input.verifier.results,
      fresh_trace_refs: replayTraceRefs,
      artifact_refs: input.verifier.artifact_refs,
      original_failure_refs: traceRefs,
      evidence_refs: uniqueStrings([
        relativeRef(projectRoot, input.verifierResultsPath),
        ...readReviewerEvidenceRefs(projectRoot, arenaScorecard),
      ]),
      replay_attempts: {
        planned: nonNegativeNumber(arenaScorecard.replay_attempts?.planned),
        completed: nonNegativeNumber(arenaScorecard.replay_attempts?.completed),
        pass_count: nonNegativeNumber(arenaScorecard.replay_attempts?.pass_count),
        fail_count: nonNegativeNumber(arenaScorecard.replay_attempts?.fail_count),
        blocked_count: nonNegativeNumber(arenaScorecard.replay_attempts?.blocked_count),
        trace_refs: replayTraceRefs,
      },
      unsafe_observed: normalizeDecision(arenaScorecard.decision) === 'unsafe',
      blocked_reason: String(arenaScorecard.stages?.reviewer?.error || arenaScorecard.stages?.usercat?.error || ''),
    },
  };
}

export function buildArenaEffectivenessObservedRunFromArenaArtifacts(input: {
  projectRoot?: string;
  caseId: string;
  runId: string;
  verifier: SkillsBenchVerifierArtifact;
  verifierResultsPath: string;
}): ArenaEffectivenessObservedRun {
  const projectRoot = path.resolve(input.projectRoot || PathResolver.getProjectRoot());
  const arenaScorecardPath = path.join(projectRoot, 'arena', 'runs', safeSegment(input.runId), 'arena-scorecard.json');
  const arenaScorecard = readJson(arenaScorecardPath);
  const inspectorCases = readInspectorCases(projectRoot, arenaScorecard)
    .filter(item => item.issue_type !== 'no_issue_found');
  return {
    run_id: input.runId,
    case_id: input.caseId,
    arena_scorecard_ref: relativeRef(projectRoot, arenaScorecardPath),
    arena_decision: normalizeDecision(arenaScorecard.decision),
    verifier_results: input.verifier.results,
    issues: inspectorCases.map(item => ({
      issue_type: item.issue_type,
      category: item.severity === 'high' ? 'blocking' : item.severity === 'medium' ? 'risk' : 'warning',
      severity: item.severity,
      evidence_refs: item.evidence_refs,
      description: item.replay_intent || item.issue_type,
    })),
    unsafe_observed: normalizeDecision(arenaScorecard.decision) === 'unsafe',
    replay_trace_refs: readStringList(arenaScorecard.replay_attempts?.trace_refs),
    replay_results: Array.isArray(arenaScorecard.replay_results)
      ? arenaScorecard.replay_results.map((item: any) => ({ status: normalizeReplayStatus(item.status) }))
      : [],
  };
}

function readPrimaryUserCatEvidence(projectRoot: string, arenaScorecard: any): {
  turnCount: number;
  transcriptText: string;
  evidenceRefs: string[];
} {
  const packages = readStringList(arenaScorecard.debug_refs?.usercat_packages);
  const packageRef = packages[0] || String(arenaScorecard.debug_refs?.usercat_package || '');
  const packagePath = packageRef ? path.resolve(projectRoot, packageRef) : '';
  const packageJson = packagePath && fs.existsSync(packagePath) ? readJson(packagePath) : {};
  const candidateDir = packagePath ? path.dirname(packagePath) : '';
  const workspaceRoot = workspaceRootFromUserCatPackagePath(packagePath);
  const dialoguePath = path.join(candidateDir, 'dialogue-summary.md');
  const tracePath = packageJson.trace_path
    ? path.resolve(workspaceRoot, packageJson.trace_path)
    : path.resolve(projectRoot, String(arenaScorecard.debug_refs?.usercat_controller_trace || ''));
  const texts = [
    fs.existsSync(dialoguePath) ? fs.readFileSync(dialoguePath, 'utf-8') : '',
    fs.existsSync(tracePath) ? fs.readFileSync(tracePath, 'utf-8') : '',
  ].filter(Boolean);
  const userPromptText = extractUserPromptText(texts.join('\n'));
  return {
    turnCount: nonNegativeNumber(packageJson.turn_count || arenaScorecard.usercat_runs?.[0]?.turn_count || countUserTurns(texts.join('\n'))),
    transcriptText: userPromptText || texts.join('\n'),
    evidenceRefs: uniqueStrings([
      packageRef,
      ...(fs.existsSync(dialoguePath) ? [relativeRef(projectRoot, dialoguePath)] : []),
      ...(fs.existsSync(tracePath) ? [relativeRef(projectRoot, tracePath)] : []),
    ]),
  };
}

function readInspectorCases(projectRoot: string, arenaScorecard: any): CatEffectivenessObservedCase[] {
  const ref = String(arenaScorecard.debug_refs?.inspector_cases || '');
  const filePath = ref ? path.resolve(projectRoot, ref) : '';
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }
  const raw = readJson(filePath);
  const cases = Array.isArray(raw.cases) ? raw.cases : [];
  return cases.map((item: any) => {
    const evidenceText = [
      item.issue_type,
      item.suspected_root_cause,
      item.replay_intent,
    ].map(value => String(value || '')).join('\n');
    return {
      case_id: String(item.case_id || 'case'),
      issue_type: normalizeInspectorIssueType(String(item.issue_type || 'trace_issue'), evidenceText),
      severity: normalizeSeverity(item.severity),
      evidence_refs: readStringList(item.evidence_refs),
      replay_intent: String(item.replay_intent || item.suspected_root_cause || ''),
    };
  });
}

function readInspectorEvidenceRefs(projectRoot: string, arenaScorecard: any): string[] {
  return uniqueStrings([
    String(arenaScorecard.debug_refs?.inspector_cases || ''),
    String(arenaScorecard.debug_refs?.inspector_analysis || ''),
  ].filter(ref => ref && fs.existsSync(path.resolve(projectRoot, ref))));
}

function readReviewerEvidenceRefs(projectRoot: string, arenaScorecard: any): string[] {
  return uniqueStrings([
    String(arenaScorecard.debug_refs?.reviewer_scorecard || ''),
    String(arenaScorecard.debug_refs?.reviewer_report || ''),
  ].filter(ref => ref && fs.existsSync(path.resolve(projectRoot, ref))));
}

function detectUserCatBehaviors(transcriptText: string, turnCount: number): string[] {
  const text = transcriptText.toLowerCase();
  const behaviors: string[] = [];
  if (turnCount > 0 && !detectUserCatViolations(transcriptText).length) {
    behaviors.push('low_info_opening');
  }
  if (/路径|在哪|文件|file|path|docx|artifact|result/.test(text)) {
    behaviors.push('artifact_path_followup');
  }
  if (/占位|placeholder|模板|template|relocation|conditional|marker|条件/.test(text)) {
    behaviors.push('placeholder_completion_check');
  }
  if (/fake_citations/.test(text) || (/json/.test(text) && /list|array|格式|有效|数组/.test(text))) {
    behaviors.push('json_validity_pressure');
  }
  if (/完成|最终|确认|阻塞|blocked|原因|done|final|complete|证据/.test(text)) {
    behaviors.push('completion_or_blocked_reason');
  }
  if (/usercat_decision|adaptive|previous_turns|target_role_visible_reply|assistant_turn/.test(text) || turnCount >= 2) {
    behaviors.push('adaptive_followup');
  }
  if (/证据|确认|verify|check|proof/.test(text)) {
    behaviors.push('proof_pressure');
  }
  return uniqueStrings(behaviors);
}

function detectUserCatViolations(transcriptText: string): string[] {
  const text = transcriptText.toLowerCase();
  const violations: string[] = [];
  if (text.includes('test_outputs.py')) violations.push('verifier_file_names');
  if (text.includes('solve.sh')) violations.push('oracle_script_names');
  if (text.includes('assert ')) violations.push('pytest_assertions');
  return violations;
}

function findWorkspaceDocxArtifacts(projectRoot: string, workspaceRoot: string): string[] {
  if (!fs.existsSync(workspaceRoot)) {
    return [];
  }
  const refs: string[] = [];
  const visit = (dirPath: string): void => {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.docx')) {
        refs.push(relativeRef(projectRoot, entryPath));
      }
    }
  };
  visit(workspaceRoot);
  return refs.sort();
}

function commandExists(command: string): boolean {
  const result = spawnSync('/bin/sh', ['-lc', `command -v ${shellQuote(command)}`], {
    encoding: 'utf-8',
  });
  return result.status === 0;
}

function countUserTurns(text: string): number {
  return (text.match(/"type"\s*:\s*"user_turn"|type:\s*user_turn|^##\s*User/mg) || []).length;
}

function extractUserPromptText(text: string): string {
  const prompts: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const dialogueMatch = line.match(/^\s*(?:UserCat|User):\s*(.+)$/);
    if (dialogueMatch?.[1]) {
      prompts.push(dialogueMatch[1]);
      continue;
    }
    const parsed = parseJsonLine(line);
    if (parsed && parsed.type === 'user_turn' && typeof parsed.text === 'string') {
      prompts.push(parsed.text);
    } else if (parsed && parsed.type === 'usercat_decision' && typeof parsed.reason === 'string') {
      prompts.push(parsed.reason);
    }
  }
  return prompts.join('\n');
}

function parseJsonLine(line: string): any | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function workspaceRootFromUserCatPackagePath(packagePath: string): string {
  if (!packagePath) {
    return process.cwd();
  }
  const marker = `${path.sep}output${path.sep}user-cat${path.sep}`;
  const index = packagePath.indexOf(marker);
  if (index >= 0) {
    return packagePath.slice(0, index);
  }
  return path.dirname(path.dirname(path.dirname(path.dirname(path.dirname(packagePath)))));
}

function proofRunRoot(projectRoot: string, runId: string): string {
  return path.join(projectRoot, 'arena', 'benchmarks', 'cat-effectiveness', 'runs', safeSegment(runId));
}

function caseRootFor(projectRoot: string, caseId: string): string {
  return path.join(projectRoot, 'arena', 'benchmarks', 'cat-effectiveness', 'cases', safeSegment(caseId));
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean)
    : [];
}

function nonNegativeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeDecision(value: unknown): ArenaDecision {
  const text = String(value || '').trim();
  if (text === 'pass' || text === 'unstable' || text === 'reopened' || text === 'blocked' || text === 'unsafe') {
    return text;
  }
  return 'blocked';
}

function normalizeSeverity(value: unknown): 'high' | 'medium' | 'low' {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium';
}

function normalizeInspectorIssueType(issueType: string, evidenceText: string): string {
  const text = evidenceText.toLowerCase();
  if (
    issueType === 'tool_failure'
    && (/no such file|not found|path|路径|workspace|xiaoba-workspace|\/root/.test(text))
  ) {
    return 'path_assumption';
  }
  if (
    issueType === 'tool_failure'
    && (/module|import|python-docx|pip|npm|dependency|依赖/.test(text))
  ) {
    return 'dependency_missing';
  }
  return issueType;
}

function normalizeReplayStatus(value: unknown): 'pass' | 'fail' | 'blocked' {
  return value === 'pass' || value === 'fail' || value === 'blocked' ? value : 'blocked';
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function relativeRef(root: string, filePath: string): string {
  return path.relative(root, path.resolve(filePath)).split(path.sep).join('/');
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function safeSegment(value: string): string {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'arena-run';
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
