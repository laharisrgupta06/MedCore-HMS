import type {
  OperationsAnalytics,
  OverviewAnalytics,
  SearchKind,
  SearchResults,
} from '@medcore/types';
import { apiRequest, qs } from '@/lib/api-client';

export const analyticsApi = {
  overview: (from: string, to: string) =>
    apiRequest<OverviewAnalytics>(`/analytics/overview${qs({ from, to })}`),
  operations: (from: string, to: string) =>
    apiRequest<OperationsAnalytics>(`/analytics/operations${qs({ from, to })}`),
  search: (q: string, kinds?: SearchKind[]) =>
    apiRequest<SearchResults>(
      `/search${qs({ q, kinds: kinds?.length ? kinds.join(',') : undefined })}`,
    ),
};
