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
  const effectiveRoleName = roleName || contextRoleName || RoleResolver.getActiveRoleName();

  return new ToolManager(
    workingDirectory,
    { ...contextDefaults, ...(effectiveRoleName ? { roleName: effectiveRoleName } : {}) },
    getRoleSpecificToolsForRole(effectiveRoleName),
  );
}
