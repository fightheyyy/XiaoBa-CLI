import { getRoleSpecificTools } from '../roles/runtime-role-registry';
import { ToolManager } from '../tools/tool-manager';
import { ToolExecutionContext } from '../types/tool';

export function createRoleAwareToolManager(
  workingDirectory: string = process.cwd(),
  contextDefaults: Partial<ToolExecutionContext> = {},
): ToolManager {
  return new ToolManager(workingDirectory, contextDefaults, getRoleSpecificTools());
}
