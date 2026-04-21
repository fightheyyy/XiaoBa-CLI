import { afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LocalReviewerWritebackExecutor } from '../src/roles/reviewer-cat/utils/reviewer-writeback-executor';

describe('LocalReviewerWritebackExecutor', () => {
  let testRoot: string;
  let repoRoot: string;
  let workspaceDir: string;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-reviewer-writeback-'));
    repoRoot = path.join(testRoot, 'repo');
    workspaceDir = path.join(testRoot, 'workspace');
    fs.mkdirSync(repoRoot, { recursive: true });
    fs.mkdirSync(workspaceDir, { recursive: true });
  });

  afterEach(() => {
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  test('会把 patch 自动回写到仓库', async () => {
    execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'pipe' });

    const targetFile = path.join(repoRoot, 'demo.txt');
    fs.writeFileSync(targetFile, 'old value\n', 'utf-8');
    execFileSync('git', ['add', 'demo.txt'], { cwd: repoRoot, stdio: 'pipe' });

    fs.writeFileSync(targetFile, 'new value\n', 'utf-8');
    const patchText = execFileSync('git', ['diff', '--', 'demo.txt'], {
      cwd: repoRoot,
      stdio: 'pipe',
      encoding: 'utf-8',
    }) as string;
    assert.match(patchText, /demo\.txt/);

    fs.writeFileSync(targetFile, 'old value\n', 'utf-8');
    const patchPath = path.join(workspaceDir, 'implementation.patch');
    fs.writeFileSync(patchPath, patchText, 'utf-8');

    const executor = new LocalReviewerWritebackExecutor({ repoRoot });
    const result = await executor.execute({
      detail: {
        case: {
          case_id: 'case-001',
          title: 'Apply runtime patch',
          status: 'closed',
          category: 'runtime_bug',
        },
        artifacts: [],
        events: [],
      },
      workspaceDir,
      downloadedArtifacts: [{
        artifactId: 'art-patch',
        type: 'patch',
        stage: 'execution',
        title: 'Engineer patch',
        localPath: 'implementation.patch',
        originalFilename: 'implementation.patch',
      }],
      writebackPlan: {
        enabled: true,
        reason: 'Validated patch can be written back.',
        actions: [{
          target: 'runtime',
          action: 'apply_patch',
          summary: 'Apply runtime patch',
          applyMode: 'auto',
          paths: ['demo.txt'],
          sourceArtifacts: ['implementation.patch'],
        }],
      },
    });

    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.actionResults.length, 1);
    assert.strictEqual(fs.readFileSync(targetFile, 'utf-8').replace(/\r\n/g, '\n'), 'new value\n');
  });
});
