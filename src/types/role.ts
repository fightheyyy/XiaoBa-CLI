export interface RoleConfig {
  name?: string;
  displayName?: string;
  description?: string;
  promptFile?: string;
  aliases?: string[];
  inheritBaseSkills?: boolean;
  excludeBaseSkills?: string[];
  metadata?: Record<string, unknown>;
}
