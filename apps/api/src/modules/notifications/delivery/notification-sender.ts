import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NOTIFICATION_SOCKET_EVENTS } from '@medcore/types';
import type { Env } from '../../../config/env';
import {
  MAIL_ADAPTER,
  SMS_ADAPTER,
  type MailAdapter,
  type SmsAdapter,
} from '../../../infra/messaging/messaging.types';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { CONTENT } from '../notification-content';
import { NotificationsGateway } from '../realtime/notifications.gateway';
import { MAX_DELIVERY_ATTEMPTS } from './notification-dispatch';

/** Section of the web app an email or SMS links to, by notification type (DEC-065: no ids). */
const PATH_OF: Record<string, string> = {
  'appointment.reminder.24h': '/portal/appointments',
  'appointment.reminder.1h': '/portal/appointments',
  ...Object.fromEntries(
    Object.entries(CONTENT)
      .filter(([k]) => k !== 'appointmentReminder')
      .map(([, f]) => {
        const c = (f as () => { type: string; path: string })();
        return [c.type, c.path];
      }),
  ),
};

/** Thrown for a delivery that can never succeed (for example no phone number); not retried. */
class Undeliverable extends Error {}

/**
 * Sends one delivery through its channel and records the outcome (attempts, lastError, sentAt).
 * Email and SMS go through the existing adapters (SMTP, Mailpit in development; the development SMS
 * inbox or Twilio). Message text is the stored title and body plus a link to a section of the web
 * app (DEC-065); bodies are never logged. A transient failure is rethrown so BullMQ retries it.
 */
@Injectable()
export class NotificationSender {
  private readonly log = new Logger('NotificationSender');
  private readonly web: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
    @Inject(MAIL_ADAPTER) private readonly mail: MailAdapter,
    @Inject(SMS_ADAPTER) private readonly sms: SmsAdapter,
    @Optional() private readonly gateway?: NotificationsGateway,
  ) {
    this.web = config.get('WEB_APP_URL', { infer: true }).replace(/\/$/, '');
  }

  async deliver(deliveryId: string): Promise<'sent' | 'skipped' | 'failed'> {
    const d = await this.prisma.notificationDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        notification: {
          include: {
            recipient: {
              select: {
                email: true,
                phone: true,
                phoneVerifiedAt: true,
                firstName: true,
                isActive: true,
              },
            },
          },
        },
      },
    });
    if (!d || d.status !== 'PENDING') return 'skipped';
    const n = d.notification;
    const link = `${this.web}${PATH_OF[n.type] ?? '/'}`;
    try {
      if (!n.recipient.isActive) throw new Undeliverable('recipient account is inactive');
      switch (d.channel) {
        case 'EMAIL':
          await this.mail.send({
            to: n.recipient.email,
            subject: n.title,
            text: `Hello ${n.recipient.firstName},\n\n${n.body}\n\nSign in to see the details: ${link}\n\nMedCore HMS`,
          });
          break;
        case 'SMS':
          // Unchanged rule from the reminders: SMS only to a verified phone number.
          if (!n.recipient.phone || !n.recipient.phoneVerifiedAt)
            throw new Undeliverable('no verified phone number on the account');
          await this.sms.send({ to: n.recipient.phone, body: `MedCore: ${n.body} ${link}` });
          break;
        case 'IN_APP': {
          const unread = await this.prisma.notification.count({
            where: { recipientId: n.recipientId, readAt: null },
          });
          this.gateway?.emitToUser(n.recipientId, NOTIFICATION_SOCKET_EVENTS.created, {
            id: n.id,
            type: n.type,
            title: n.title,
            body: n.body,
            entityType: n.entityType,
            entityId: n.entityId,
            readAt: n.readAt?.toISOString() ?? null,
            createdAt: n.createdAt.toISOString(),
          });
          this.gateway?.emitToUser(n.recipientId, NOTIFICATION_SOCKET_EVENTS.unread, { unread });
          break;
        }
      }
      await this.prisma.notificationDelivery.update({
        where: { id: d.id },
        data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 }, lastError: null },
      });
      return 'sent';
    } catch (e) {
      const attempts = d.attempts + 1;
      const final = e instanceof Undeliverable || attempts >= MAX_DELIVERY_ATTEMPTS;
      // Only the error message is kept, shortened; adapters never include message bodies in errors.
      await this.prisma.notificationDelivery.update({
        where: { id: d.id },
        data: {
          attempts,
          lastError: String((e as Error).message ?? e).slice(0, 300),
          status: final ? 'FAILED' : 'PENDING',
        },
      });
      if (final) {
        this.log.warn(`Delivery ${d.id} (${d.channel}) failed: ${(e as Error).message}`);
        return 'failed';
      }
      throw e;
    }
  }
}
