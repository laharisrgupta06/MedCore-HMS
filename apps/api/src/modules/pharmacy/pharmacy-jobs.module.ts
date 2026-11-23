import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Module, OnApplicationBootstrap } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { scheduledJobsEnabled } from '../../config/env';
import { QueueModule } from '../../infra/queue/queue.module';
import { ExpirySweep, PHARMACY_QUEUE } from './expiry-sweep';
import { PharmacyModule } from './pharmacy.module';

@Processor(PHARMACY_QUEUE)
export class ExpirySweepProcessor extends WorkerHost {
  constructor(private readonly sweep: ExpirySweep) {
    super();
  }
  async process(): Promise<void> {
    await this.sweep.runDue();
  }
}

/** Scheduler id and pattern: minute 7 of every hour (each hospital is processed once, after 02:00 local). */
export const EXPIRY_SCHEDULER_ID = 'expiry-sweep';
export const EXPIRY_SCHEDULE = '7 * * * *';

/** One BullMQ job scheduler (idempotent across restarts and API instances): minute 7 of every hour. */
@Injectable()
export class ExpirySweepScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(PHARMACY_QUEUE) private readonly queue: Queue) {}
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      EXPIRY_SCHEDULER_ID,
      { pattern: EXPIRY_SCHEDULE },
      {
        name: 'expiry-sweep',
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: 50,
          removeOnFail: 100,
        },
      },
    );
  }
}

/** The queue, worker and schedule (application only; tests call ExpirySweep directly). */
@Module({
  imports: [QueueModule, PharmacyModule, BullModule.registerQueue({ name: PHARMACY_QUEUE })],
  providers: [ExpirySweepProcessor, ExpirySweepScheduler],
})
export class PharmacyJobsModule {}

/**
 * The worker and schedule, registered only where timed jobs are enabled (DEC-043): on by default
 * (pnpm dev, production), off when NODE_ENV=test or SCHEDULED_JOBS=off, which the integration-test
 * setup always forces. Without this module the app has no worker for the pharmacy queue, so even a
 * schedule left in Redis by a development run is never processed by a test app.
 */
export const pharmacyJobs = () =>
  ConditionalModule.registerWhen(PharmacyJobsModule, (env) => scheduledJobsEnabled(env), {
    debug: false,
  });
