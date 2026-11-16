import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import {
  MAIL_ADAPTER,
  SMS_ADAPTER,
  type MailAdapter,
  type SmsAdapter,
} from '../../infra/messaging/messaging.types';
import { PrismaService } from '../../infra/prisma/prisma.service';

export const APPOINTMENTS_QUEUE = 'appointments';
export const REMINDER_SCHEDULER = Symbol('REMINDER_SCHEDULER');

/** APPT-005: reminders 24 hours and 1 hour before, by email and SMS. */
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

/** Sends a reminder if the appointment is still active and was not moved since the job was queued. */
@Processor(APPOINTMENTS_QUEUE)
export class ReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(ReminderProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAIL_ADAPTER) private readonly mail: MailAdapter,
    @Inject(SMS_ADAPTER) private readonly sms: SmsAdapter,
  ) {
    super();
  }

  async process(job: Job<ReminderJob>): Promise<void> {
    await sendReminder(this.prisma, this.mail, this.sms, job.data, this.logger);
  }
}

/** Exported for tests. System job: reads with the base client (no request tenant). */
export async function sendReminder(
  prisma: Pick<PrismaService, 'appointment'>,
  mail: MailAdapter,
  sms: SmsAdapter,
  data: ReminderJob,
  logger?: Logger,
): Promise<'sent' | 'skipped'> {
  const a = await prisma.appointment.findUnique({
    where: { id: data.appointmentId },
    include: {
      patient: { include: { user: true } },
      doctor: { include: { user: true } },
      hospital: true,
    },
  });
  if (
    !a ||
    !['PENDING', 'CONFIRMED'].includes(a.status) ||
    a.scheduledAt.toISOString() !== data.scheduledAt
  )
    return 'skipped';
  const when = new Intl.DateTimeFormat('en-IN', {
    timeZone: a.hospital.timezone,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(a.scheduledAt);
  const label = REMINDER_OFFSETS.find((o) => o.key === data.offset)?.label ?? 'soon';
  const text = `Reminder: your appointment with Dr ${a.doctor.user.firstName} ${a.doctor.user.lastName} at ${a.hospital.name} is ${label}, ${when}.`;
  const u = a.patient.user;
  await mail.send({
    to: u.email,
    subject: 'Appointment reminder',
    text: `Hello ${u.firstName},\n\n${text}\n\nIf you cannot attend, please cancel or reschedule in the patient portal.`,
  });
  if (u.phone && u.phoneVerifiedAt) {
    await sms
      .send({ to: u.phone, body: `MedCore: ${text}` })
      .catch((e: Error) => logger?.warn(`Reminder SMS failed for ${a.id}: ${e.message}`));
  }
  return 'sent';
}
