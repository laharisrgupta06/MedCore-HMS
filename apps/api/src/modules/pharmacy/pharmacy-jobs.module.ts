import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Module, OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
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

/** One BullMQ job scheduler (idempotent across restarts and API instances): minute 7 of every hour. */
@Injectable()
export class ExpirySweepScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(PHARMACY_QUEUE) private readonly queue: Queue) {}
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'expiry-sweep',
      { pattern: '7 * * * *' },
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
