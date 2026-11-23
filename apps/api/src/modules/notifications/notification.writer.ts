import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { NotificationChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NOTIFICATION_DISPATCH, type NotificationDispatch } from './delivery/notification-dispatch';
import type { NotificationContent } from './notification-content';

export interface NotifyInput {
  hospitalId: string | null;
  recipientIds: string[];
  content: NotificationContent;
  entityType: string;
  entityId: string;
}

/** Delivery rows written by `stage`; queue them with `dispatch` once the transaction has committed. */
export type StagedDeliveries = { id: string; channel: NotificationChannel }[];

type Tx = Prisma.TransactionClient;

/**
 * Durable notifications (DEC-062). `stage` writes the `notifications` row and one
 * `notification_deliveries` row per channel inside the caller's business transaction, so the
 * notification exists if and only if the business change committed. After commit the caller passes
 * the result to `dispatch`, which queues the delivery jobs; if that never happens (crash, Redis
 * down), the sweeper finds the PENDING deliveries and queues them.
 *
 * Duplicates: a `once` notification is skipped when one already exists for the same recipient,
 * type and entity; `same-body` also requires the same body (reminders: one per appointment time).
 * Callers run inside transactions that lock the entity row (appointment, invoice, payment, order),
 * so writers for one entity are serialised. The lookup is the fast path; the database is the final
 * guard (M-15): one-time notifications carry a `dedupeKey`, unique per recipient, and are inserted
 * with ON CONFLICT DO NOTHING, so a concurrent duplicate is skipped without aborting the caller's
 * transaction (a caught unique violation would).
 */
@Injectable()
export class NotificationWriter {
  private readonly log = new Logger('Notifications');

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(NOTIFICATION_DISPATCH) private readonly queue?: NotificationDispatch,
  ) {}

  async stage(tx: Tx, input: NotifyInput): Promise<StagedDeliveries> {
    const { content } = input;
    const out: StagedDeliveries = [];
    for (const recipientId of [...new Set(input.recipientIds)]) {
      if (content.once) {
        const seen = await tx.notification.findFirst({
          where: {
            recipientId,
            type: content.type,
            entityId: input.entityId,
            ...(content.once === 'same-body' ? { body: content.body } : {}),
          },
          select: { id: true },
        });
        if (seen) continue;
      }
      const data = {
        hospitalId: input.hospitalId,
        recipientId,
        type: content.type,
        title: content.title,
        body: content.body,
        entityType: input.entityType,
        entityId: input.entityId,
      };
      let n: { id: string } | undefined;
      if (content.once) {
        [n] = await tx.notification.createManyAndReturn({
          data: [{ ...data, dedupeKey: dedupeKey(content, input.entityId) }],
          skipDuplicates: true,
          select: { id: true },
        });
        if (!n) continue; // written by a concurrent transaction
      } else {
        n = await tx.notification.create({ data, select: { id: true } });
      }
      for (const channel of content.channels)
        out.push(
          await tx.notificationDelivery.create({
            data: { notificationId: n.id, hospitalId: input.hospitalId, channel },
            select: { id: true, channel: true },
          }),
        );
    }
    return out;
  }

  /** Queues delivery jobs for committed rows. Never throws: the sweeper is the fallback. */
  async dispatch(...batches: (StagedDeliveries | null | undefined)[]): Promise<void> {
    const all = batches.flatMap((b) => b ?? []);
    if (!all.length || !this.queue) return;
    await this.queue
      .enqueue(all)
      .catch((e: Error) =>
        this.log.warn(`Delivery jobs not queued (the sweeper will retry): ${e.message}`),
      );
  }
}

/**
 * Database duplicate key for one-time notifications (M-15): "<type>:<entityId>", plus a short hash
 * of the body for same-body notifications, so a reminder for a moved appointment (new time, new
 * body) is a new notification.
 */
export function dedupeKey(content: NotificationContent, entityId: string): string {
  const base = `${content.type}:${entityId}`;
  return content.once === 'same-body'
    ? `${base}:${createHash('sha256').update(content.body).digest('hex').slice(0, 16)}`
    : base;
}
