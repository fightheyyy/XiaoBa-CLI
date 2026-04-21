import { Router } from 'express';
import { Tool } from '../types/tool';
import { RoleResolver } from '../utils/role-resolver';
import { isAutoDevConfigured } from '../utils/autodev-config';
import { AutoDevEngineerWorker } from './engineer-cat/utils/autodev-engineer-worker';
import { AnalyzeLogTool } from './inspector-cat/tools/analyze-log-tool';
import { InspectPendingLogsTool } from './inspector-cat/tools/inspect-pending-logs-tool';
import { RunPendingLogBatchTool } from './inspector-cat/tools/run-pending-log-batch-tool';
import { RunInspectorBatchTool } from './inspector-cat/tools/run-inspector-batch-tool';
import { setActiveAutoDevInspectorWorker } from './inspector-cat/utils/autodev-inspector-runtime';
import { AutoDevInspectorWorker } from './inspector-cat/utils/autodev-inspector-worker';
import { createInspectorApiRouter } from './inspector-cat/utils/inspector-api-router';
import { InspectorHookRuntime, InspectorHookRuntimeOptions } from './inspector-cat/utils/inspector-runtime-support';
import { AutoDevReviewerWorker } from './reviewer-cat/utils/autodev-reviewer-worker';

export interface RoleRuntimeSupport {
  stop(): Promise<void>;
}

function isInspectorRole(): boolean {
  const activeRole = RoleResolver.getActiveRoleName();
  return !!activeRole && RoleResolver.normalizeRoleName(activeRole) === 'inspector-cat';
}

function isEngineerRole(): boolean {
  const activeRole = RoleResolver.getActiveRoleName();
  return !!activeRole && RoleResolver.normalizeRoleName(activeRole) === 'engineer-cat';
}

function isReviewerRole(): boolean {
  const activeRole = RoleResolver.getActiveRoleName();
  return !!activeRole && RoleResolver.normalizeRoleName(activeRole) === 'reviewer-cat';
}

export function getRoleSpecificTools(): Tool[] {
  if (isInspectorRole()) {
    return [new AnalyzeLogTool(), new InspectPendingLogsTool(), new RunPendingLogBatchTool(), new RunInspectorBatchTool()];
  }
  return [];
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
    if (isAutoDevConfigured()) {
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
    if (!isAutoDevConfigured()) {
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
    if (!isAutoDevConfigured()) {
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
