import type { UserSummary } from '@medcore/types';
import { apiList, apiRequest, qs } from '@/lib/api-client';

export interface UpdateUserBody {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  isActive?: boolean;
}

export const usersApi = {
  list: (q: {
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
    isActive?: boolean;
    hospitalId?: string;
  }) => apiList<UserSummary>(`/users${qs(q)}`),
  get: (id: string) => apiRequest<UserSummary>(`/users/${id}`),
  update: (id: string, body: UpdateUserBody) =>
    apiRequest<UserSummary>(`/users/${id}`, { method: 'PATCH', json: body }),
  remove: (id: string) =>
    apiRequest<{ id: string; deleted: true }>(`/users/${id}`, { method: 'DELETE' }),
};
