import type { Queue } from 'bullmq';
import { assertBullAccepts } from '../../testing/validating-queue';
import { BullPdfJobs, pdfJobId, type PdfJob } from './pdf-jobs';

/**
 * Regression: ids of the form "prescription:<uuid>" were refused by BullMQ ("Custom Id cannot
 * contain :"), so no PDF was ever queued. The fake queue runs BullMQ's own option validation,
 * the same check Queue.add runs before it reaches Redis.
 */
function validatingQueue() {
  const added: { name: string; data: PdfJob; opts: { jobId?: string } }[] = [];
  const existing = new Map<string, { isFailed: () => Promise<boolean>; remove: jest.Mock }>();
  const queue = {
    getJob: jest.fn(async (id: string) => existing.get(id)),
    add: jest.fn(async (name: string, data: PdfJob, opts: { jobId?: string }) => {
      assertBullAccepts(name, data, opts);
      added.push({ name, data, opts });
      return {};
    }),
  };
  return { queue, added, existing };
}

const job: PdfJob = {
  kind: 'prescription',
  id: '3f2a6c1e-1111-4222-8333-944455556666',
  hospitalId: 'h1',
};

describe('BullPdfJobs', () => {
  it('the validating queue really applies BullMQ rules (guards this test itself)', async () => {
    const { queue } = validatingQueue();
    await expect(queue.add('render', job, { jobId: `prescription:${job.id}` })).rejects.toThrow(
      'Custom Id cannot contain :',
    );
  });

  it('queues a render with an id BullMQ accepts, one per document', async () => {
    const { queue, added } = validatingQueue();
    await new BullPdfJobs(queue as unknown as Queue<PdfJob>).enqueue(job);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      name: 'render',
      data: job,
      opts: { jobId: `prescription-${job.id}`, attempts: 3 },
    });
    expect(pdfJobId({ kind: 'lab-report', id: job.id })).toBe(`lab-report-${job.id}`);
    expect(pdfJobId(job)).not.toContain(':');
  });

  it('replaces a failed job so a retry can be queued, and leaves a pending one alone', async () => {
    const { queue, added, existing } = validatingQueue();
    const failed = { isFailed: async () => true, remove: jest.fn() };
    existing.set(pdfJobId(job), failed);
    await new BullPdfJobs(queue as unknown as Queue<PdfJob>).enqueue(job);
    expect(failed.remove).toHaveBeenCalledTimes(1);
    const pending = { isFailed: async () => false, remove: jest.fn() };
    existing.set(pdfJobId(job), pending);
    await new BullPdfJobs(queue as unknown as Queue<PdfJob>).enqueue(job);
    expect(pending.remove).not.toHaveBeenCalled();
    expect(added).toHaveLength(2);
  });
});
