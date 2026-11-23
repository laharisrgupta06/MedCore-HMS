/** Notifications (Phase 9; PRD NOTIF-001..010, DEC-062, DEC-063, DEC-065). */
export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL', 'SMS'] as const;
export type NotificationChannelName = (typeof NOTIFICATION_CHANNELS)[number];

/** Notification types. Titles and bodies never carry clinical details (DEC-065). */
export const NOTIFICATION_TYPES = [
  'appointment.reminder.24h',
  'appointment.reminder.1h',
  'appointment.confirmed',
  'appointment.cancelled',
  'appointment.rescheduled',
  'appointment.emergency',
  'lab.report.ready',
  'prescription.ready',
  'invoice.issued',
  'payment.received',
  'stock.low',
  'stock.expiring',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface UnreadCountView {
  unread: number;
}

/** Socket.IO events sent to the room of one user. */
export const NOTIFICATION_SOCKET_EVENTS = {
  created: 'notification:created',
  unread: 'notification:unread',
} as const;
