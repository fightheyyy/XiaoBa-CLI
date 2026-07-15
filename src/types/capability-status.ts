export const CAPABILITY_STATUSES = ['candidate', 'active', 'blocked'] as const;

export type CapabilityStatus = typeof CAPABILITY_STATUSES[number];

export function parseCapabilityStatus(
  value: unknown,
  source: string = 'capability',
): CapabilityStatus {
  if (value === undefined || value === null || value === '') {
    return 'active';
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if ((CAPABILITY_STATUSES as readonly string[]).includes(normalized)) {
      return normalized as CapabilityStatus;
    }
  }

  throw new Error(
    `Invalid ${source} status: ${JSON.stringify(value)}. Expected candidate, active, or blocked.`,
  );
}
