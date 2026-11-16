import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { PdfService } from './pdf.service';

export const PDF_QUEUE = 'pdf';
export const PDF_JOBS = Symbol('PDF_JOBS');

export interface PdfJob {
  kind: 'prescription' | 'lab-report';
  id: string;
  hospitalId: string;
}
export type PdfRenderer = (job: PdfJob) => Promise<void>;

/** Feature modules register how to build each kind of document; the worker only dispatches. */
@Injectable()
export class PdfRenderers {
  private readonly renderers = new Map<PdfJob['kind'], PdfRenderer>();
  register(kind: PdfJob['kind'], r: PdfRenderer): void {
    this.renderers.set(kind, r);
  }
  run(job: PdfJob): Promise<void> {
    const r = this.renderers.get(job.kind);
    if (!r) throw new Error(`No PDF renderer for ${job.kind}`);
    return r(job);
  }
}

export interface PdfJobs {
  /** Queues a render after the transaction commits; one job per document (idempotent id). */
  enqueue(job: PdfJob): Promise<void>;
}

@Injectable()
export class BullPdfJobs implements PdfJobs {
  constructor(@InjectQueue(PDF_QUEUE) private readonly queue: Queue<PdfJob>) {}

  async enqueue(job: PdfJob): Promise<void> {
    const jobId = `${job.kind}:${job.id}`;
    const old = await this.queue.getJob(jobId);
    // A failed job keeps its id; remove it so a retry can be queued.
    if (old && (await old.isFailed())) await old.remove();
    await this.queue.add('render', job, {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }
}

@Processor(PDF_QUEUE)
export class PdfProcessor extends WorkerHost {
  constructor(private readonly renderers: PdfRenderers) {
    super();
  }
  process(job: Job<PdfJob>): Promise<void> {
    return this.renderers.run(job.data);
  }
}

/** PDF building and the renderer registry: no Redis needed, so tests use it as is. */
@Global()
@Module({ providers: [PdfService, PdfRenderers], exports: [PdfService, PdfRenderers] })
export class PdfCoreModule {}

/** The BullMQ queue and worker (application only; tests provide PDF_JOBS inline). */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: PDF_QUEUE })],
  providers: [{ provide: PDF_JOBS, useClass: BullPdfJobs }, PdfProcessor],
  exports: [PDF_JOBS],
})
export class PdfQueueModule {}

export const InjectPdfJobs = () => Inject(PDF_JOBS);
