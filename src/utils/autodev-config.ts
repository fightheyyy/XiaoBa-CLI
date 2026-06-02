export function getAutoDevServerUrl(): string {
  return String(
    process.env.AUTODEV_SERVER_URL
    || process.env.XIAOBA_AUTODEV_SERVER_URL
    || '',
  ).trim().replace(/\/+$/, '');
}

export function getAutoDevApiKey(): string {
  return String(process.env.AUTODEV_API_KEY || '').trim();
}

export function isAutoDevEnabled(): boolean {
  const raw = process.env.AUTODEV_ENABLED || process.env.XIAOBA_AUTODEV_ENABLED || '';
  return String(raw).trim().toLowerCase() === 'true';
}

export function isAutoDevConfigured(): boolean {
  return !!getAutoDevServerUrl();
}

export function isAutoDevRuntimeEnabled(): boolean {
  return isAutoDevEnabled() && isAutoDevConfigured();
}
