import type { HealthStatus } from '@medcore/types';
import { apiRequest } from '@/lib/api-client';

export const healthQueryKey = ['health'] as const;
export const getHealth = (): Promise<HealthStatus> => apiRequest<HealthStatus>('/health');
