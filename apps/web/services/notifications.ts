import type { NotificationView, UnreadCountView } from '@medcore/types';
import { apiList, apiRequest, qs } from '@/lib/api-client';

/** The signed-in user's own notifications (Phase 9). */
export const notificationsApi = {
  list: (q: { unread?: boolean; page?: number; limit?: number }) =>
    apiList<NotificationView>(`/notifications${qs({ ...q, unread: q.unread || undefined })}`),
  unreadCount: () => apiRequest<UnreadCountView>('/notifications/unread-count'),
  markRead: (id: string) =>
    apiRequest<NotificationView>(`/notifications/${id}/read`, { method: 'PATCH' }),
  markAllRead: () => apiRequest<{ marked: number }>('/notifications/read-all', { method: 'POST' }),
};
