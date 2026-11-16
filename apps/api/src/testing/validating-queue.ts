import { Job } from 'bullmq';

/**
 * A queue double that runs BullMQ's own job-option validation (the check Queue.add runs before
 * Redis), so tests catch ids BullMQ refuses, such as ones containing ":".
 */
export function assertBullAccepts(name: string, data: unknown, opts: object): void {
  const job = new Job({ opts: {}, keys: {}, toKey: (k: string) => k } as never, name, data, opts);
  (job as unknown as { validateOptions(j: unknown): void }).validateOptions(job.asJSON());
}
