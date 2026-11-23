import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Global, Injectable, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import type { NotificationChannel } from '@prisma/client';
import type { Job, Queue } from 'bullmq';
import { scheduledJobsEnabled } from '../../../config/env';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { QueueModule } from '../../../infra/queue/queue.module';
import { NotificationsGateway } from '../realtime/notifications.gateway';
import {
  MAX_DELIVERY_ATTEMPTS,
  NOTIFICATION_DISPATCH,
  NOTIFY_QUEUES,
  NOTIFY_SWEEP_QUEUE,
  deliveryJobId,
  type DeliveryJob,
  type NotificationDispatch,
} from './notification-dispatch';
import { NotificationSender } from './notification-sender';

const JOB_OPTS = {
  attempts: MAX_DELIVERY_ATTEMPTS,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: true,
  removeOnFail: 200,
};

@Injectable()
export class BullNotificationDispatch implements NotificationDispatch {
  private readonly queues: Record<NotificationChannel, Queue<DeliveryJob>>;
  constructor(
    @InjectQueue(NOTIFY_QUEUES.EMAIL) email: Queue<DeliveryJob>,
    @InjectQueue(NOTIFY_QUEUES.SMS) sms: Queue<DeliveryJob>,
    @InjectQueue(NOTIFY_QUEUES.IN_APP) inApp: Queue<DeliveryJob>,
  ) {
    this.queues = { EMAIL: email, SMS: sms, IN_APP: inApp };
  }

  async enqueue(
    deliveries: { id: string; channel: NotificationChannel; attempts?: number }[],
  ): Promise<void> {
    for (const d of deliveries)
      await this.queues[d.channel].add(
        'deliver',
        { deliveryId: d.id },
        { ...JOB_OPTS, jobId: deliveryJobId(d.id, d.attempts ?? 0) },
      );
  }
}

abstract class ChannelWorker extends WorkerHost {
  constructor(private readonly sender: NotificationSender) {
    super();
  }
  async process(job: Job<DeliveryJob>): Promise<void> {
    await this.sender.deliver(job.data.deliveryId);
  }
}
@Processor(NOTIFY_QUEUES.EMAIL)
export class EmailDeliveryWorker extends ChannelWorker {}
@Processor(NOTIFY_QUEUES.SMS)
export class SmsDeliveryWorker extends ChannelWorker {}
@Processor(NOTIFY_QUEUES.IN_APP)
export class InAppDeliveryWorker extends ChannelWorker {}

/** Re-queues deliveries still PENDING after a while: lost jobs, a restart, or Redis briefly down. */
export const SWEEP_AFTER_MS = 2 * 60_000;
@Processor(NOTIFY_SWEEP_QUEUE)
export class DeliverySweeper extends WorkerHost {
  private readonly log = new Logger('DeliverySweeper');
  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: BullNotificationDispatch,
  ) {
    super();
  }
  async process(): Promise<void> {
    const stale = await this.prisma.notificationDelivery.findMany({
      where: {
        status: 'PENDING',
        attempts: { lt: MAX_DELIVERY_ATTEMPTS },
        updatedAt: { lt: new Date(Date.now() - SWEEP_AFTER_MS) },
      },
      select: { id: true, channel: true, attempts: true },
      take: 500,
    });
    if (stale.length) this.log.log(`Re-queueing ${stale.length} pending deliveries`);
    // A sweep job id per attempt count: a job already waiting for this attempt is not added twice.
    await this.dispatch.enqueue(stale.map((s) => ({ ...s, attempts: s.attempts + 1 })));
  }
}

@Injectable()
export class DeliverySweepSchedule implements OnApplicationBootstrap {
  constructor(@InjectQueue(NOTIFY_SWEEP_QUEUE) private readonly queue: Queue) {}
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'notification-sweep',
      { every: 5 * 60_000 },
      {
        name: 'sweep',
        opts: { removeOnComplete: 20, removeOnFail: 50 },
      },
    );
  }
}

const QUEUES = [...Object.values(NOTIFY_QUEUES), NOTIFY_SWEEP_QUEUE].map((name) =>
  BullModule.registerQueue({ name }),
);

/** The sweeper's worker and schedule, only where timed jobs are enabled (DEC-043), like the expiry sweep. */
@Module({
  imports: [QueueModule, ...QUEUES],
  providers: [DeliverySweeper, DeliverySweepSchedule, BullNotificationDispatch],
})
export class NotificationSweepModule {}
export const notificationSweep = () =>
  ConditionalModule.registerWhen(NotificationSweepModule, (env) => scheduledJobsEnabled(env), {
    debug: false,
  });

/** Per-channel queues and workers, the dispatcher and the Socket.IO gateway (application only). */
@Global()
@Module({
  imports: [QueueModule, ...QUEUES],
  providers: [
    NotificationsGateway,
    NotificationSender,
    BullNotificationDispatch,
    { provide: NOTIFICATION_DISPATCH, useExisting: BullNotificationDispatch },
    EmailDeliveryWorker,
    SmsDeliveryWorker,
    InAppDeliveryWorker,
  ],
  exports: [NOTIFICATION_DISPATCH],
})
export class NotificationsDeliveryModule {}
