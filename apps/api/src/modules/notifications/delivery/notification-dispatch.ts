import type { NotificationChannel } from '@prisma/client';

/** NOTIF-010: one BullMQ queue per channel, so a failing SMS provider never holds back email. */
export const NOTIFY_QUEUES: Record<NotificationChannel, string> = {
  EMAIL: 'notify-email',
  SMS: 'notify-sms',
  IN_APP: 'notify-inapp',
};
export const NOTIFY_SWEEP_QUEUE = 'notify-sweep';

/** Attempts per delivery before it is marked FAILED. */
export const MAX_DELIVERY_ATTEMPTS = 5;

export interface DeliveryJob {
  deliveryId: string;
}

export const NOTIFICATION_DISPATCH = Symbol('NOTIFICATION_DISPATCH');

export interface NotificationDispatch {
  /** Queues one job per delivery, after the rows are committed. Never throws to the caller. */
  enqueue(deliveries: { id: string; channel: NotificationChannel }[]): Promise<void>;
}

/** Job id per delivery and attempt, so a double enqueue is ignored and a sweep can retry. */
export const deliveryJobId = (id: string, attempt: number) => `delivery-${id}-${attempt}`;
