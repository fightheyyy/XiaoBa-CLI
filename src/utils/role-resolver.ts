import * as fs from 'fs';
import * as path from 'path';
import { RoleConfig } from '../types/role';

const ROLE_ENV_KEYS = ['XIAOBA_ROLE', 'CURRENT_ROLE'] as const;
const DEFAULT_ROLE_NAMES = new Set(['', 'base', 'default', 'none']);

export class RoleResolver {
  static getProjectRoot(): string {
    return process.cwd();
  }

  static getRolesRoot(): string {
    return path.join(this.getProjectRoot(), 'roles');
  }

  static normalizeRoleName(roleName: string): string {
    return roleName
      .trim()
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .toLowerCase();
  }

  static activateRole(roleName?: string): void {
    const requested = roleName?.trim()
      || process.env.XIAOBA_ROLE?.trim()
      || process.env.CURRENT_ROLE?.trim()
      || '';

    if (DEFAULT_ROLE_NAMES.has(this.normalizeRoleName(requested))) {
      this.clearActiveRole();
      return;
    }

    const resolvedRoleDir = this.resolveRoleDirectoryName(requested);
    if (!resolvedRoleDir) {
      const available = this.listAvailableRoles();
      const detail = available.length > 0
        ? `可用角色：${available.join(', ')}`
        : '当前项目还没有 roles 目录或角色定义。';
      throw new Error(`未找到角色 "${requested}"。${detail}`);
    }

    process.env.XIAOBA_ROLE = resolvedRoleDir;
    process.env.CURRENT_ROLE = resolvedRoleDir;

    const config = this.getRoleConfig(resolvedRoleDir);
    if (config?.displayName) {
      process.env.CURRENT_ROLE_DISPLAY_NAME = config.displayName;
    } else {
      delete process.env.CURRENT_ROLE_DISPLAY_NAME;
    }
  }

  static clearActiveRole(): void {
    for (const key of ROLE_ENV_KEYS) {
      delete process.env[key];
    }
    delete process.env.CURRENT_ROLE_DISPLAY_NAME;
  }

  static getActiveRoleName(): string | undefined {
    const requested = process.env.XIAOBA_ROLE?.trim() || process.env.CURRENT_ROLE?.trim();
    if (!requested) {
      return undefined;
    }
    return this.resolveRoleDirectoryName(requested) || undefined;
  }

  static getActiveRolePath(): string | undefined {
    const roleName = this.getActiveRoleName();
    if (!roleName) {
      return undefined;
    }
    return path.join(this.getRolesRoot(), roleName);
  }

  static getActiveRoleConfig(): RoleConfig | undefined {
    const roleName = this.getActiveRoleName();
    if (!roleName) {
      return undefined;
    }
    return this.getRoleConfig(roleName);
  }

  static getRoleConfig(roleDirName: string): RoleConfig | undefined {
    const configPath = path.join(this.getRolesRoot(), roleDirName, 'role.json');
    if (!fs.existsSync(configPath)) {
      return undefined;
    }

    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as RoleConfig;
    } catch (error: any) {
      throw new Error(`角色配置解析失败 (${configPath}): ${error.message}`);
    }
  }

  static listAvailableRoles(): string[] {
    const rolesRoot = this.getRolesRoot();
    if (!fs.existsSync(rolesRoot)) {
      return [];
    }

    return fs.readdirSync(rolesRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b));
  }

  static resolveRoleDirectoryName(roleName: string): string | undefined {
    const normalized = this.normalizeRoleName(roleName);
    if (DEFAULT_ROLE_NAMES.has(normalized)) {
      return undefined;
    }

    const rolesRoot = this.getRolesRoot();
    if (!fs.existsSync(rolesRoot)) {
      return undefined;
    }

    const exactPath = path.join(rolesRoot, roleName);
    if (fs.existsSync(exactPath) && fs.statSync(exactPath).isDirectory()) {
      return path.basename(exactPath);
    }

    const matched = this.listAvailableRoles()
      .find(candidate => this.normalizeRoleName(candidate) === normalized);

    return matched || undefined;
  }
}
