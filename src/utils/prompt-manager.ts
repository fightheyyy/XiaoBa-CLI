import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PathResolver } from './path-resolver';
import { RoleResolver } from './role-resolver';

/**
 * System Prompt 管理器
 */
export class PromptManager {
  private static promptsDir = path.join(__dirname, '../../prompts');

  private static getRuntimeEnvironmentInfo(platform: NodeJS.Platform = process.platform): string[] {
    const normalized = platform.toLowerCase() as NodeJS.Platform;

    if (normalized === 'win32') {
      return [
        '当前操作系统：Windows',
        'execute_shell 默认使用系统 shell；在 Windows 下按 cmd.exe 语义优先思考。如需 PowerShell，请显式写 `powershell -Command "..."`。',
        'Windows 下优先使用 `read_file`、`glob`、`grep` 等工具；必须走 shell 时优先考虑 `dir`、`type`、`findstr`、`if exist`。',
        'Windows 下避免默认使用 `ls`、`head`、`tail`、`find -maxdepth` 这类 Unix 风格命令。',
      ];
    }

    if (normalized === 'darwin') {
      return [
        '当前操作系统：macOS',
        'execute_shell 默认按 Unix shell 语义工作，可优先考虑 `ls`、`cat`、`grep`、`find`。',
        'macOS 自带命令多为 BSD 版本，避免默认假设 GNU 专属参数一定可用。',
      ];
    }

    if (normalized === 'linux') {
      return [
        '当前操作系统：Linux',
        'execute_shell 默认按 Unix shell 语义工作，可优先考虑 `ls`、`cat`、`grep`、`find`。',
        'Linux 环境通常兼容常见 POSIX/GNU 命令，但仍应优先使用结构化工具而不是长链式 shell。',
      ];
    }

    const label = os.platform();
    return [
      `当前操作系统：${label}`,
      'execute_shell 使用系统默认 shell。执行命令前先判断平台兼容性，并优先使用结构化工具。',
    ];
  }

  private static readPromptFile(filePath: string): string | undefined {
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return undefined;
    }
  }

  private static resolvePromptFile(fileName: string): string | undefined {
    const rolePromptPath = PathResolver.getRoleSubPath(path.join('prompts', fileName));
    if (rolePromptPath && fs.existsSync(rolePromptPath)) {
      return rolePromptPath;
    }

    const basePromptPath = path.join(this.promptsDir, fileName);
    return fs.existsSync(basePromptPath) ? basePromptPath : undefined;
  }

  /**
   * 获取基础 system prompt
   */
  static getBaseSystemPrompt(): string {
    try {
      const roleConfig = RoleResolver.getActiveRoleConfig();
      const promptFile = roleConfig?.promptFile || 'system-prompt.md';
      const resolvedPath = this.resolvePromptFile(promptFile);
      if (resolvedPath) {
        return fs.readFileSync(resolvedPath, 'utf-8');
      }
      if (promptFile !== 'system-prompt.md') {
        const fallbackPath = this.resolvePromptFile('system-prompt.md');
        if (fallbackPath) {
          return fs.readFileSync(fallbackPath, 'utf-8');
        }
      }
      return this.getDefaultSystemPrompt();
    } catch (error) {
      return this.getDefaultSystemPrompt();
    }
  }

  /**
   * 获取 behavior prompt（用户偏好）
   */
  static getBehaviorPrompt(): string {
    try {
      const resolvedPath = this.resolvePromptFile('behavior.md');
      if (!resolvedPath) {
        return '';
      }
      const content = fs.readFileSync(resolvedPath, 'utf-8').trim();
      // 如果只有模板内容，返回空
      if (content.includes('（在下方添加你的个性化设置）')) {
        return '';
      }
      return content;
    } catch {
      return '';
    }
  }

  /**
   * 构建完整 system prompt（包含运行时信息）
   */
  static async buildSystemPrompt(): Promise<string> {
    const basePrompt = this.getBaseSystemPrompt().trim();
    const behaviorPrompt = this.getBehaviorPrompt().trim();
    const displayName = (
      process.env.CURRENT_AGENT_DISPLAY_NAME
      || process.env.BOT_BRIDGE_NAME
      || ''
    ).trim();
    const roleName = RoleResolver.getActiveRoleName() || '';
    const roleDisplayName = process.env.CURRENT_ROLE_DISPLAY_NAME || RoleResolver.getActiveRoleConfig()?.displayName || roleName;
    const platform = process.env.CURRENT_PLATFORM || '';
    const today = new Date().toISOString().slice(0, 10);
    const runtimeEnvironmentInfo = this.getRuntimeEnvironmentInfo();

    // 动态生成工作空间路径
    const workspaceName = displayName || 'default';
    const workspacePath = `~/xiaoba-workspace/${workspaceName}`;

    const runtimeInfo = [
      displayName ? `你在这个平台上的名字是：${displayName}` : '',
      roleName ? `当前角色：${roleDisplayName}` : '',
      platform ? `当前平台：${platform}` : '',
      `当前日期：${today}`,
      `你的默认工作目录是：\`${workspacePath}\``,
      ...runtimeEnvironmentInfo,
    ].filter(Boolean).join('\n');

    return [basePrompt, behaviorPrompt, runtimeInfo].filter(Boolean).join('\n\n');
  }

  /**
   * 默认 system prompt（当文件不存在时使用）
   */
  private static getDefaultSystemPrompt(): string {
    return `你是小八。

你和用户交流时，保持自然、直接、可信。

工作原则：
1. 只根据当前对话、真实上下文和当前运行时提供的能力行动。
2. 不编造自己拥有的工具、技能、历史记忆或已完成的工作。
3. 先理解问题，再决定是否需要行动或回复。
4. 当前这一轮没有新信息时，不要为了显得热情而额外寒暄。`;
  }
}
