import { after, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import { PromptManager } from '../src/utils/prompt-manager';
import { RoleResolver } from '../src/utils/role-resolver';

const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
const originalPlatformEnv = process.env.CURRENT_PLATFORM;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
}

describe('PromptManager runtime environment injection', () => {
  beforeEach(() => {
    RoleResolver.clearActiveRole();
    delete process.env.CURRENT_PLATFORM;
  });

  test('Windows 下应注入操作系统和 cmd/PowerShell 提示', async () => {
    setPlatform('win32');

    const prompt = await PromptManager.buildSystemPrompt();

    assert.ok(prompt.includes('当前操作系统：Windows'));
    assert.ok(prompt.includes('cmd.exe 语义'));
    assert.ok(prompt.includes('powershell -Command'));
    assert.ok(prompt.includes('避免默认使用 `ls`、`head`、`tail`、`find -maxdepth`'));
  });

  test('Linux 下应注入 Unix shell 提示', async () => {
    setPlatform('linux');

    const prompt = await PromptManager.buildSystemPrompt();

    assert.ok(prompt.includes('当前操作系统：Linux'));
    assert.ok(prompt.includes('Unix shell 语义'));
    assert.ok(prompt.includes('`ls`、`cat`、`grep`、`find`'));
  });

  test('macOS 下应注入 BSD 命令提示', async () => {
    setPlatform('darwin');

    const prompt = await PromptManager.buildSystemPrompt();

    assert.ok(prompt.includes('当前操作系统：macOS'));
    assert.ok(prompt.includes('Unix shell 语义'));
    assert.ok(prompt.includes('BSD 版本'));
  });
});

after(() => {
  if (originalPlatformDescriptor) {
    Object.defineProperty(process, 'platform', originalPlatformDescriptor);
  }

  if (originalPlatformEnv) {
    process.env.CURRENT_PLATFORM = originalPlatformEnv;
  } else {
    delete process.env.CURRENT_PLATFORM;
  }

  RoleResolver.clearActiveRole();
});
