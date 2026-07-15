import { getRoleSpecificToolsForRole } from '../roles/runtime-role-registry';
import { ToolManager } from '../tools/tool-manager';
import { ToolExecutionContext } from '../types/tool';
import { RoleResolver } from '../utils/role-resolver';

export function createRoleAwareToolManager(
  workingDirectory: string = process.cwd(),
  contextDefaults: Partial<ToolExecutionContext> = {},
  roleName?: string,
): ToolManager {
  const contextRoleName = typeof contextDefaults.roleName === 'string' && contextDefaults.roleName.trim()
    ? contextDefaults.roleName.trim()
    : undefined;
  const requestedRoleName = roleName || contextRoleName || RoleResolver.getActiveRoleName();
  const effectiveRoleName = requestedRoleName
    ? RoleResolver.resolveRoleDirectoryName(requestedRoleName)
    : undefined;
  if (requestedRoleName && !effectiveRoleName) {
    throw new Error(`Role "${requestedRoleName}" is unavailable or blocked.`);
  }
  const roleConfig = effectiveRoleName ? RoleResolver.getRoleConfig(effectiveRoleName) : undefined;

  return new ToolManager(
    workingDirectory,
    { ...contextDefaults, ...(effectiveRoleName ? { roleName: effectiveRoleName } : {}) },
    getRoleSpecificToolsForRole(effectiveRoleName),
    {
      inheritBaseTools: roleConfig?.inheritBaseTools,
      baseToolAllowlist: roleConfig?.baseToolAllowlist,
      baseToolDenylist: roleConfig?.baseToolDenylist,
    },
  );
}
