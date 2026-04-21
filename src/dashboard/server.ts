import express from 'express';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { createApiRouter } from './routes/api';
import { ServiceManager } from './service-manager';

const DEFAULT_PORT = 3800;
const DEFAULT_HOST = '127.0.0.1';

export async function startDashboard(port: number = DEFAULT_PORT, host?: string): Promise<void> {
  const app = express();
  const projectRoot = process.cwd();
  const serviceManager = new ServiceManager(projectRoot);
  const bodyLimit = process.env.XIAOBA_API_BODY_LIMIT || '50mb';
  const listenHost = host || process.env.XIAOBA_DASHBOARD_HOST || DEFAULT_HOST;

  app.use(express.json({ limit: bodyLimit }));

  // API routes
  app.use('/api', createApiRouter(serviceManager));

  // Serve frontend
  const frontendPath = path.join(__dirname, '../../dashboard');
  app.use(express.static(frontendPath));

  // SPA fallback
  app.use((_req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });

  // 优雅退出
  process.on('SIGINT', () => {
    serviceManager.stopAll();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    serviceManager.stopAll();
    process.exit(0);
  });

  app.listen(port, listenHost, () => {
    Logger.success(`\nXiaoBa Dashboard 已启动`);
    Logger.info(`监听地址: http://${listenHost}:${port}\n`);
  });
}
