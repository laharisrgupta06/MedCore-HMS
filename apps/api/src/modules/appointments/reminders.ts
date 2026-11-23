import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CONTENT } from '../notifications/notification-content';
import { NotificationWriter } from '../notifications/notification.writer';

export const APPOINTMENTS_QUEUE = 'appointments';
export const REMINDER_SCHEDULER = Symbol('REMINDER_SCHEDULER');

/** APPT-005 / NOTIF-003: reminders 24 hours and 1 hour before (in-app, email and SMS since Phase 9). */
export const REMINDER_OFFSETS = [
  { key: '24h', ms: 24 * 60 * 60 * 1000, label: 'tomorrow' },
  { key: '1h', ms: 60 * 60 * 1000, label: 'in one hour' },
] as const;

/** BullMQ refuses ":" in custom ids (it reserves it for repeatable jobs), so parts are joined with "-". */
export const reminderJobId = (appointmentId: string, key: string): string =>
  `reminder-${appointmentId}-${key}`;
/** The form used before Phase 6; still removed on cancel so jobs queued earlier are cleaned up. */
const legacyReminderJobId = (appointmentId: string, key: string): string =>
  `reminder:${appointmentId}:${key}`;

export interface ReminderScheduler {
  schedule(appointmentId: string, scheduledAt: Date): Promise<void>;
  cancel(appointmentId: string): Promise<void>;
}

interface ReminderJob {
  appointmentId: string;
  scheduledAt: string;
  offset: (typeof REMINDER_OFFSETS)[number]['key'];
}

/** BullMQ delayed jobs, one per offset, with deterministic ids so they can be replaced or removed. */
@Injectable()
export class BullReminderScheduler implements ReminderScheduler {
  constructor(@InjectQueue(APPOINTMENTS_QUEUE) private readonly queue: Queue<ReminderJob>) {}

  async schedule(appointmentId: string, scheduledAt: Date): Promise<void> {
    await this.cancel(appointmentId);
    for (const o of REMINDER_OFFSETS) {
      const delay = scheduledAt.getTime() - o.ms - Date.now();
      if (delay <= 0) continue; // too late for this reminder
      await this.queue.add(
        'reminder',
        { appointmentId, scheduledAt: scheduledAt.toISOString(), offset: o.key },
        {
          jobId: reminderJobId(appointmentId, o.key),
          delay,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    }
  }

  async cancel(appointmentId: string): Promise<void> {
    for (const o of REMINDER_OFFSETS) {
      for (const id of [
        reminderJobId(appointmentId, o.key),
        legacyReminderJobId(appointmentId, o.key),
      ]) {
        const job = await this.queue.getJob(id);
        if (job) await job.remove().catch(() => undefined);
      }
    }
  }
}

/**
 * Sends a reminder if the appointment is still active and was not moved since the job was queued.
 * Since Phase 9 it is a durable notification (in-app, email, SMS) with the same delivery tracking,
 * per-channel queues and retries as every other notification.
 */
@Processor(APPOINTMENTS_QUEUE)
export class ReminderProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: NotificationWriter,
  ) {
    super();
  }

  async process(job: Job<ReminderJob>): Promise<void> {
    await sendReminder(this.prisma, this.writer, job.data);
  }
}

/**
 * Exported for tests. System job: the base client (no request tenant), every row with its hospitalId.
 * The appointment row is locked first, so a retried job and the original cannot both write; the
 * notification is skipped when this patient already has a reminder of this offset for the same
 * appointment time (a rescheduled visit gets new reminders, because its time differs).
 */
export async function sendReminder(
  prisma: Pick<PrismaService, '$transaction'>,
  writer: Pick<NotificationWriter, 'stage' | 'dispatch'>,
  data: ReminderJob,
): Promise<'sent' | 'skipped'> {
  const staged = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${data.appointmentId}::uuid FOR UPDATE`;
    const a = await tx.appointment.findUnique({
      where: { id: data.appointmentId },
      include: {
        patient: { select: { userId: true } },
        hospital: { select: { name: true, timezone: true } },
      },
    });
    if (
      !a ||
      !['PENDING', 'CONFIRMED'].includes(a.status) ||
      a.scheduledAt.toISOString() !== data.scheduledAt
    )
      return null;
    const when = new Intl.DateTimeFormat('en-IN', {
      timeZone: a.hospital.timezone,
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(a.scheduledAt);
    return writer.stage(tx, {
      hospitalId: a.hospitalId,
      recipientIds: [a.patient.userId],
      content: CONTENT.appointmentReminder(`${when} at ${a.hospital.name}`, data.offset),
      entityType: 'Appointment',
      entityId: a.id,
    });
  });
  if (!staged || staged.length === 0) return 'skipped';
  await writer.dispatch(staged);
  return 'sent';
}
