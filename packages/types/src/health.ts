export type DependencyStatus = 'up' | 'down';

/** Response data of GET /api/health. */
export interface HealthStatus {
  status: 'ok' | 'degraded';
  db: DependencyStatus;
  redis: DependencyStatus;
  queue: DependencyStatus;
  uptimeSeconds: number;
  timestamp: string;
}
