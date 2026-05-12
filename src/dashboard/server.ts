import express from 'express';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { createApiRouter } from './routes/api';
import { ServiceManager } from './service-manager';

const DEFAULT_PORT = 3800;
const DEFAULT_HOST = '127.0.0.1';

export interface DashboardServerOptions {
  onNavigate?: (page: string) => void;
}

export async function startDashboard(
  port: number = DEFAULT_PORT,
  host?: string,
  options: DashboardServerOptions = {},
): Promise<void> {
  const app = express();
  const projectRoot = process.cwd();
  const bodyLimit = process.env.XIAOBA_API_BODY_LIMIT || '50mb';
  const listenHost = host || process.env.XIAOBA_DASHBOARD_HOST || DEFAULT_HOST;
  const advertisedHost = listenHost === '0.0.0.0' ? '127.0.0.1' : listenHost;
  process.env.XIAOBA_DASHBOARD_URL = `http://${advertisedHost}:${port}`;
  const serviceManager = new ServiceManager(projectRoot);

  app.use(express.json({ limit: bodyLimit }));

  // API routes
  app.use('/api', createApiRouter(serviceManager, { onNavigate: options.onNavigate }));

  // Serve frontend
  const frontendPath = path.join(__dirname, '../../dashboard');
  app.use(express.static(frontendPath));

  // SPA fallback
  app.use((_req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });

  // 优雅退出
  const shutdown = () => {
    serviceManager.stopAll();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  app.listen(port, listenHost, () => {
    Logger.success(`\nXiaoBa Dashboard 已启动`);
    Logger.info(`访问地址: ${process.env.XIAOBA_DASHBOARD_URL}`);
    if (listenHost !== advertisedHost) {
      Logger.info(`监听地址: http://${listenHost}:${port}`);
    }
    Logger.info('');
  });
}
