import { Router } from 'express';
import { Tool } from '../types/tool';
import { RoleResolver } from '../utils/role-resolver';
import { ConfigManager } from '../utils/config';
import { AIService } from '../utils/ai-service';
import { SkillManager } from '../skills/skill-manager';
import { ToolManager } from '../tools/tool-manager';
import {
  EngineerCodexSupervisorCancelTool,
  EngineerCodexSupervisorResumeTool,
  EngineerCodexSupervisorStartTool,
  EngineerCodexSupervisorStatusTool,
  EngineerTaskCancelTool,
  EngineerTaskResumeTool,
  EngineerTaskRunTool,
  EngineerTaskStatusTool,
} from './engineer-cat/tools/engineer-task-tools';
import { AnalyzeLogTool } from './inspector-cat/tools/analyze-log-tool';
import {
  CodexJobCancelTool,
  CodexJobResumeTool,
  CodexJobStartTool,
  CodexJobStatusTool,
  CodexSessionListTool,
} from './reviewer-cat/tools/codex-job-tools';
import { GuideTpcEvalAnalysisTool } from './guide/tools/eval-analysis-tool';
import { GuideTpcEnvBaselineTool } from './guide/tools/env-baseline-tool';
import { GuideTpcBaselineTool } from './guide/tools/tpc-baseline-tool';
import { ReviewerEvalPrepareTool } from './reviewer-cat/tools/reviewer-eval-tool';
import { ReviewerXiaoBaCliE2ETool } from './reviewer-cat/tools/xiaoba-cli-e2e-tool';
import { ReviewerModuleTestTool } from './reviewer-cat/tools/module-test-tool';
import { ResearchBoardReadTool, ResearchBoardUpdateTool } from './researcher-cat/tools/research-board-tools';
import { ResearchAutoResearchRunTool } from './researcher-cat/tools/research-auto-run-tool';
import { FeishuAuthLoginCompleteTool, FeishuAuthLoginStartTool, FeishuAuthStatusTool } from './secretary-cat/tools/feishu-auth-tools';
import { DefaultLarkCliRunner } from './secretary-cat/utils/lark-cli-runner';
import {
  FeishuCalendarAgendaTool,
  FeishuCalendarCreateTool,
  FeishuCalendarDeleteTool,
  FeishuCalendarUpdateTool,
} from './secretary-cat/tools/feishu-calendar-tools';
import {
  FeishuBaseFieldListTool,
  FeishuBaseRecordListTool,
  FeishuBaseRecordUpsertConfirmedTool,
  FeishuBaseTableListTool,
  FeishuSheetsAppendConfirmedTool,
  FeishuSheetsReadTool,
} from './secretary-cat/tools/feishu-data-tools';
import {
  FeishuDocsCreateConfirmedTool,
  FeishuDocsFetchTool,
  FeishuDocsSearchTool,
  FeishuDocsUpdateConfirmedTool,
} from './secretary-cat/tools/feishu-doc-tools';
import {
  FeishuDriveDownloadTool,
  FeishuDriveImportConfirmedTool,
  FeishuDriveSearchTool,
  FeishuDriveUploadConfirmedTool,
} from './secretary-cat/tools/feishu-drive-tools';
import {
  FeishuMailDraftCreateTool,
  FeishuMailDraftSendConfirmedTool,
  FeishuMailReadTool,
  FeishuMailTriageTool,
} from './secretary-cat/tools/feishu-mail-tools';
import {
  FeishuContactSearchTool,
  FeishuMessageDraftTool,
  FeishuMessageSendConfirmedTool,
} from './secretary-cat/tools/feishu-message-tools';
import {
  FeishuMinutesDownloadTool,
  FeishuMinutesGetTool,
  FeishuMinutesNotesTool,
  FeishuMinutesSearchTool,
} from './secretary-cat/tools/feishu-minutes-tools';
import {
  FeishuTaskCreateConfirmedTool,
  FeishuTaskListTool,
  FeishuTaskStateConfirmedTool,
  FeishuTaskUpdateConfirmedTool,
} from './secretary-cat/tools/feishu-task-tools';
import { UserTraceRunTool } from './user-cat/tools/user-trace-run-tool';
import { createBrowserCatTools } from './browser-cat';
import { createGuiCatTools } from './gui-cat';

export interface RoleRuntimeSupport {
  stop(): Promise<void>;
}

export interface RoleRuntimeServiceOptions {
  workingDirectory?: string;
}

function normalizeRole(roleName?: string): string {
  return RoleResolver.normalizeRoleName(roleName || '');
}

function isInspectorRole(roleName?: string): boolean {
  const activeRole = roleName || RoleResolver.getActiveRoleName();
  return !!activeRole && normalizeRole(activeRole) === 'inspector-cat';
}

function isEngineerRole(roleName?: string): boolean {
  const activeRole = roleName || RoleResolver.getActiveRoleName();
  return !!activeRole && normalizeRole(activeRole) === 'engineer-cat';
}

function isReviewerRole(roleName?: string): boolean {
  const activeRole = roleName || RoleResolver.getActiveRoleName();
  return !!activeRole && normalizeRole(activeRole) === 'reviewer-cat';
}

function isResearcherRole(roleName?: string): boolean {
  const activeRole = roleName || RoleResolver.getActiveRoleName();
  return !!activeRole && normalizeRole(activeRole) === 'researcher-cat';
}

function isSecretaryRole(roleName?: string): boolean {
  const activeRole = roleName || RoleResolver.getActiveRoleName();
  return !!activeRole && normalizeRole(activeRole) === 'secretary-cat';
}

function isUserRole(roleName?: string): boolean {
  const activeRole = roleName || RoleResolver.getActiveRoleName();
  return !!activeRole && normalizeRole(activeRole) === 'user-cat';
}

function isGuideRole(roleName?: string): boolean {
  const activeRole = roleName || RoleResolver.getActiveRoleName();
  return !!activeRole && normalizeRole(activeRole) === 'guide';
}

function isBrowserRole(roleName?: string): boolean {
  const activeRole = roleName || RoleResolver.getActiveRoleName();
  return !!activeRole && normalizeRole(activeRole) === 'browser-cat';
}

function isGuiRole(roleName?: string): boolean {
  const activeRole = roleName || RoleResolver.getActiveRoleName();
  return !!activeRole && normalizeRole(activeRole) === 'gui-cat';
}

export function getRoleSpecificToolsForRole(roleName?: string): Tool[] {
  if (isBrowserRole(roleName)) {
    return createBrowserCatTools();
  }

  if (isGuiRole(roleName)) {
    return createGuiCatTools();
  }

  if (isGuideRole(roleName)) {
    return [
      new GuideTpcBaselineTool(),
      new GuideTpcEvalAnalysisTool(),
      new GuideTpcEnvBaselineTool(),
    ];
  }

  if (isUserRole(roleName)) {
    return [
      new UserTraceRunTool({
        createServices: ({ cwd, targetRole, runId }) => ({
          aiService: new AIService(),
          toolManager: new ToolManager(
            cwd,
            { roleName: targetRole, runId },
            getRoleSpecificToolsForRole(targetRole),
          ),
          skillManager: new SkillManager(targetRole),
          roleName: targetRole,
        }),
      }),
    ];
  }
  if (isResearcherRole(roleName)) {
    return [
      new ResearchAutoResearchRunTool(),
      new ResearchBoardUpdateTool(),
      new ResearchBoardReadTool(),
    ];
  }
  if (isInspectorRole(roleName)) {
    return [new AnalyzeLogTool()];
  }
  if (isSecretaryRole(roleName)) {
    const surfaceAppId = String(
      process.env.FEISHU_APP_ID || ConfigManager.getConfig().feishu?.appId || '',
    ).trim();
    const larkCli = new DefaultLarkCliRunner(
      'lark-cli',
      surfaceAppId ? { ...process.env, FEISHU_APP_ID: surfaceAppId } : process.env,
    );
    return [
      new FeishuAuthStatusTool(larkCli),
      new FeishuAuthLoginStartTool(larkCli),
      new FeishuAuthLoginCompleteTool(larkCli),
      new FeishuCalendarAgendaTool(larkCli),
      new FeishuCalendarCreateTool(larkCli),
      new FeishuCalendarUpdateTool(larkCli),
      new FeishuCalendarDeleteTool(larkCli),
      new FeishuContactSearchTool(larkCli),
      new FeishuMessageDraftTool(),
      new FeishuMessageSendConfirmedTool(larkCli),
      new FeishuTaskListTool(larkCli),
      new FeishuTaskCreateConfirmedTool(larkCli),
      new FeishuTaskUpdateConfirmedTool(larkCli),
      new FeishuTaskStateConfirmedTool(larkCli),
      new FeishuMailTriageTool(larkCli),
      new FeishuMailReadTool(larkCli),
      new FeishuMailDraftCreateTool(larkCli),
      new FeishuMailDraftSendConfirmedTool(larkCli),
      new FeishuMinutesSearchTool(larkCli),
      new FeishuMinutesGetTool(larkCli),
      new FeishuMinutesNotesTool(larkCli),
      new FeishuMinutesDownloadTool(larkCli),
      new FeishuDocsSearchTool(larkCli),
      new FeishuDocsFetchTool(larkCli),
      new FeishuDocsCreateConfirmedTool(larkCli),
      new FeishuDocsUpdateConfirmedTool(larkCli),
      new FeishuDriveSearchTool(larkCli),
      new FeishuDriveUploadConfirmedTool(larkCli),
      new FeishuDriveDownloadTool(larkCli),
      new FeishuDriveImportConfirmedTool(larkCli),
      new FeishuSheetsReadTool(larkCli),
      new FeishuSheetsAppendConfirmedTool(larkCli),
      new FeishuBaseTableListTool(larkCli),
      new FeishuBaseFieldListTool(larkCli),
      new FeishuBaseRecordListTool(larkCli),
      new FeishuBaseRecordUpsertConfirmedTool(larkCli),
    ];
  }
  if (isReviewerRole(roleName)) {
    return [
      new ReviewerEvalPrepareTool(),
      new ReviewerXiaoBaCliE2ETool(),
      new CodexSessionListTool(),
      new CodexJobStartTool(),
      new CodexJobStatusTool(),
      new CodexJobResumeTool(),
      new CodexJobCancelTool(),
      new ReviewerModuleTestTool(),
    ];
  }
  if (isEngineerRole(roleName)) {
    return [
      new EngineerCodexSupervisorStartTool(),
      new EngineerCodexSupervisorStatusTool(),
      new EngineerCodexSupervisorResumeTool(),
      new EngineerCodexSupervisorCancelTool(),
      new EngineerTaskRunTool(),
      new EngineerTaskStatusTool(),
      new EngineerTaskResumeTool(),
      new EngineerTaskCancelTool(),
      new CodexSessionListTool(),
      new CodexJobStartTool(),
      new CodexJobStatusTool(),
      new CodexJobResumeTool(),
      new CodexJobCancelTool(),
    ];
  }
  return [];
}

export function getRoleSpecificTools(): Tool[] {
  return getRoleSpecificToolsForRole(RoleResolver.getActiveRoleName());
}

export function registerRoleSpecificApiRoutes(_router: Router): void {
  return;
}

export async function startRoleRuntimeServices(
  _options: RoleRuntimeServiceOptions = {},
): Promise<RoleRuntimeSupport | null> {
  if (isEngineerRole()) {
    return null;
  }

  if (isReviewerRole()) {
    return null;
  }

  return null;
}
