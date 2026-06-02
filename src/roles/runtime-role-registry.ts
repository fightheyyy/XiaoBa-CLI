import { Router } from 'express';
import { Tool } from '../types/tool';
import { RoleResolver } from '../utils/role-resolver';
import { isAutoDevRuntimeEnabled } from '../utils/autodev-config';
import { AutoDevEngineerWorker } from './engineer-cat/utils/autodev-engineer-worker';
import {
  EngineerTaskCancelTool,
  EngineerTaskResumeTool,
  EngineerTaskRunTool,
  EngineerTaskStatusTool,
} from './engineer-cat/tools/engineer-task-tools';
import { AnalyzeLogTool } from './inspector-cat/tools/analyze-log-tool';
import { InspectPendingLogsTool } from './inspector-cat/tools/inspect-pending-logs-tool';
import { RunPendingLogBatchTool } from './inspector-cat/tools/run-pending-log-batch-tool';
import { RunInspectorBatchTool } from './inspector-cat/tools/run-inspector-batch-tool';
import { setActiveAutoDevInspectorWorker } from './inspector-cat/utils/autodev-inspector-runtime';
import { AutoDevInspectorWorker } from './inspector-cat/utils/autodev-inspector-worker';
import { createInspectorApiRouter } from './inspector-cat/utils/inspector-api-router';
import { InspectorHookRuntime, InspectorHookRuntimeOptions } from './inspector-cat/utils/inspector-runtime-support';
import { AutoDevReviewerWorker } from './reviewer-cat/utils/autodev-reviewer-worker';
import {
  CodexJobCancelTool,
  CodexJobResumeTool,
  CodexJobStartTool,
  CodexJobStatusTool,
  CodexSessionListTool,
} from './reviewer-cat/tools/codex-job-tools';
import { ReviewerEvalPrepareTool } from './reviewer-cat/tools/reviewer-eval-tool';
import { ReviewerXiaoBaCliE2ETool } from './reviewer-cat/tools/xiaoba-cli-e2e-tool';
import { ReviewerModuleTestTool } from './reviewer-cat/tools/module-test-tool';

export interface RoleRuntimeSupport {
  stop(): Promise<void>;
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

export function getRoleSpecificToolsForRole(roleName?: string): Tool[] {
  if (isInspectorRole(roleName)) {
    return [new AnalyzeLogTool(), new InspectPendingLogsTool(), new RunPendingLogBatchTool(), new RunInspectorBatchTool()];
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

export function registerRoleSpecificApiRoutes(router: Router): void {
  if (!isInspectorRole()) {
    return;
  }
  router.use(createInspectorApiRouter());
}

export async function startRoleRuntimeServices(
  options: InspectorHookRuntimeOptions = {},
): Promise<RoleRuntimeSupport | null> {
  if (isInspectorRole()) {
    if (isAutoDevRuntimeEnabled()) {
      const worker = new AutoDevInspectorWorker({
        workingDirectory: options.workingDirectory,
        reviewExecutor: options.reviewExecutor,
      });
      setActiveAutoDevInspectorWorker(worker);
      worker.start();
      return {
        async stop() {
          setActiveAutoDevInspectorWorker(null);
          worker.stop();
        },
      };
    }

    const support = new InspectorHookRuntime(options);
    await support.start();
    return support;
  }

  if (isEngineerRole()) {
    if (!isAutoDevRuntimeEnabled()) {
      return null;
    }

    const worker = new AutoDevEngineerWorker({
      workingDirectory: options.workingDirectory,
    });
    worker.start();
    return {
      async stop() {
        worker.stop();
      },
    };
  }

  if (isReviewerRole()) {
    if (!isAutoDevRuntimeEnabled()) {
      return null;
    }

    const worker = new AutoDevReviewerWorker({
      workingDirectory: options.workingDirectory,
    });
    worker.start();
    return {
      async stop() {
        worker.stop();
      },
    };
  }

  return null;
}
