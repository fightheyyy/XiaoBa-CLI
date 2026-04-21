import { RoleRuntimeSupport, startRoleRuntimeServices } from '../roles/runtime-role-registry';
import { LogIngestScheduler } from './log-ingest-scheduler';

interface ActiveRuntimeSupport {
  roleSupport: RoleRuntimeSupport | null;
  logIngestScheduler: LogIngestScheduler | null;
  stop(): Promise<void>;
}

let activeSupport: ActiveRuntimeSupport | null = null;
let startPromise: Promise<ActiveRuntimeSupport> | null = null;

export async function startRuntimeCommandSupport(): Promise<ActiveRuntimeSupport> {
  if (activeSupport) {
    return activeSupport;
  }

  if (!startPromise) {
    startPromise = (async () => {
      const roleSupport = await startRoleRuntimeServices({ workingDirectory: process.cwd() });
      const logIngestScheduler = LogIngestScheduler.shouldStartForCurrentRuntime()
        ? new LogIngestScheduler(process.cwd())
        : null;

      if (logIngestScheduler) {
        await logIngestScheduler.start();
      }

      const support: ActiveRuntimeSupport = {
        roleSupport,
        logIngestScheduler,
        async stop() {
          if (logIngestScheduler) {
            await logIngestScheduler.stop();
          }
          if (roleSupport) {
            await roleSupport.stop();
          }
        },
      };

      activeSupport = support;
      return support;
    })()
      .finally(() => {
        startPromise = null;
      })
  }

  return startPromise;
}

export async function stopRuntimeCommandSupport(): Promise<void> {
  const support = activeSupport;
  activeSupport = null;
  if (support) {
    await support.stop();
  }
}
