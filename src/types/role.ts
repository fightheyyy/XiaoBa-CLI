export interface RoleConfig {
  name?: string;
  displayName?: string;
  description?: string;
  promptFile?: string;
  inheritBaseSkills?: boolean;
  excludeBaseSkills?: string[];
  metadata?: Record<string, unknown>;
}
