import * as fs from 'fs';
import * as path from 'path';
import { RoleConfig } from '../types/role';
import { parseCapabilityStatus } from '../types/capability-status';

const DEFAULT_ROLE_NAMES = new Set(['', 'base', 'default', 'none']);

export class ActiveRoleContext {
  static getProjectRoot(): string {
    return process.env.XIAOBA_PROJECT_ROOT
      ? path.resolve(process.env.XIAOBA_PROJECT_ROOT)
      : process.cwd();
  }

  static getRolesRoot(): string {
    const candidates = [
      path.join(this.getProjectRoot(), 'roles'),
      process.env.XIAOBA_ROLES_ROOT,
      process.env.XIAOBA_APP_ROOT ? path.join(process.env.XIAOBA_APP_ROOT, 'roles') : undefined,
    ].filter((candidate): candidate is string => Boolean(candidate));

    return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
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
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as RoleConfig;
      return {
        ...config,
        status: parseCapabilityStatus(config.status, `role ${roleDirName}`),
      };
    } catch (error: any) {
      throw new Error(`角色配置解析失败 (${configPath}): ${error.message}`);
    }
  }

  /** Runtime discovery only exposes evaluated active roles. */
  static listAvailableRoles(): string[] {
    return this.listManagedRoles().filter(roleName => {
      try {
        return this.getRoleConfig(roleName)?.status === 'active';
      } catch {
        return false;
      }
    });
  }

  /** Management surfaces retain visibility of candidate and blocked role packages. */
  static listManagedRoles(): string[] {
    const rolesRoot = this.getRolesRoot();
    if (!fs.existsSync(rolesRoot)) {
      return [];
    }

    return fs.readdirSync(rolesRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b));
  }

  /**
   * Runtime resolution permits active aliases and exact candidate package names.
   * Candidate aliases are intentionally not discoverable; blocked roles never resolve.
   */
  static resolveRoleDirectoryName(roleName: string): string | undefined {
    const normalized = this.normalizeRoleName(roleName);
    if (DEFAULT_ROLE_NAMES.has(normalized)) {
      return undefined;
    }

    const direct = this.listManagedRoles()
      .find(candidate => this.normalizeRoleName(candidate) === normalized);
    if (direct) {
      try {
        const status = this.getRoleConfig(direct)?.status || 'active';
        return status === 'blocked' ? undefined : direct;
      } catch {
        return undefined;
      }
    }

    return this.listAvailableRoles().find(candidate => this.roleAliases(candidate)
      .some(alias => this.normalizeRoleName(alias) === normalized));
  }

  /** Management resolution is status-agnostic and may use aliases. */
  static resolveManagedRoleDirectoryName(roleName: string): string | undefined {
    const normalized = this.normalizeRoleName(roleName);
    if (DEFAULT_ROLE_NAMES.has(normalized)) {
      return undefined;
    }

    const direct = this.listManagedRoles()
      .find(candidate => this.normalizeRoleName(candidate) === normalized);
    if (direct) {
      return direct;
    }

    return this.listManagedRoles().find(candidate => {
      try {
        return this.roleAliases(candidate)
          .some(alias => this.normalizeRoleName(alias) === normalized);
      } catch {
        return false;
      }
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

  private static roleAliases(roleDirName: string): string[] {
    const config = this.getRoleConfig(roleDirName);
    if (!config) {
      return [];
    }
    const metadataAliases = Array.isArray(config.metadata?.aliases)
      ? config.metadata.aliases.filter((alias): alias is string => typeof alias === 'string')
      : [];
    return [
      config.name,
      config.displayName,
      ...(config.aliases || []),
      ...metadataAliases,
    ].filter((alias): alias is string => typeof alias === 'string');
  }
}
