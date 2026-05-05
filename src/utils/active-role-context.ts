import * as fs from 'fs';
import * as path from 'path';
import { RoleConfig } from '../types/role';

const DEFAULT_ROLE_NAMES = new Set(['', 'base', 'default', 'none']);

export class ActiveRoleContext {
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

    return this.listAvailableRoles()
      .find(candidate => {
        if (this.normalizeRoleName(candidate) === normalized) {
          return true;
        }

        const config = this.getRoleConfig(candidate);
        if (!config) {
          return false;
        }

        const metadataAliases = Array.isArray(config.metadata?.aliases)
          ? config.metadata.aliases.filter((alias): alias is string => typeof alias === 'string')
          : [];
        const aliases = [
          config.name,
          config.displayName,
          ...(config.aliases || []),
          ...metadataAliases,
        ].filter((alias): alias is string => typeof alias === 'string');

        return aliases.some(alias => this.normalizeRoleName(alias) === normalized);
      });
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

  static getActiveRoleDisplayName(): string | undefined {
    const roleName = this.getActiveRoleName();
    if (!roleName) {
      return undefined;
    }

    return process.env.CURRENT_ROLE_DISPLAY_NAME
      || this.getActiveRoleConfig()?.displayName
      || roleName;
  }
}
