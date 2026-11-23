import type { PortalSummaryView } from '@medcore/types';
import { apiRequest } from '@/lib/api-client';

export const portalApi = {
  summary: () => apiRequest<PortalSummaryView>('/portal/summary'),
};
