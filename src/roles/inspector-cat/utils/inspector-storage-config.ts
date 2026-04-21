export interface InspectorMySqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface InspectorPersistenceConfig {
  mysql: InspectorMySqlConfig | null;
  remoteRequired: boolean;
}

const DEFAULT_MYSQL_PORT = 3306;
const DEFAULT_MYSQL_DATABASE = 'xiaoba_inspector';

export function resolveInspectorPersistenceConfig(): InspectorPersistenceConfig {
  return {
    mysql: resolveMySqlConfig(),
    remoteRequired: String(process.env.INSPECTOR_REMOTE_REQUIRED || '').trim().toLowerCase() === 'true',
  };
}

function resolveMySqlConfig(): InspectorMySqlConfig | null {
  const host = String(process.env.MYSQL_HOST || '').trim();
  const user = String(process.env.MYSQL_USER || '').trim();
  if (!host || !user) {
    return null;
  }

  return {
    host,
    port: parsePort(process.env.MYSQL_PORT, DEFAULT_MYSQL_PORT),
    user,
    password: String(process.env.MYSQL_PASSWORD || ''),
    database: String(process.env.MYSQL_DATABASE || DEFAULT_MYSQL_DATABASE).trim() || DEFAULT_MYSQL_DATABASE,
  };
}

function parsePort(rawValue: string | undefined, fallback: number): number {
  const parsed = Number(rawValue || fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}
