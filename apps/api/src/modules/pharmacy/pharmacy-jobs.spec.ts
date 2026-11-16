import { ConfigModule } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type { ExpirySweep } from './expiry-sweep';
import {
  EXPIRY_SCHEDULE,
  EXPIRY_SCHEDULER_ID,
  ExpirySweepProcessor,
  ExpirySweepScheduler,
  PharmacyJobsModule,
  pharmacyJobs,
} from './pharmacy-jobs.module';

/**
 * DEC-043: the nightly expiry worker and schedule are part of the app only where timed jobs are
 * enabled. `pharmacyJobs()` is the exact import AppModule uses.
 */
describe('pharmacy timed jobs wiring', () => {
  const saved = { ...process.env };
  beforeAll(async () => {
    // Resolves ConfigModule.envVariablesLoaded, which ConditionalModule waits for.
    await ConfigModule.forRoot({ ignoreEnvFile: true });
  });
  afterEach(() => {
    process.env = { ...saved };
  });
  const registered = async (env: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const mod = await pharmacyJobs();
    return (mod.imports ?? []).includes(PharmacyJobsModule);
  };

  it('pnpm dev (development, no setting) registers the worker and schedule', async () => {
    expect(await registered({ NODE_ENV: 'development', SCHEDULED_JOBS: undefined })).toBe(true);
  });
  it('production registers them unless switched off', async () => {
    expect(await registered({ NODE_ENV: 'production', SCHEDULED_JOBS: undefined })).toBe(true);
    expect(await registered({ NODE_ENV: 'production', SCHEDULED_JOBS: 'off' })).toBe(false);
  });
  it('integration tests (SCHEDULED_JOBS=off forced by test/load-env.ts) and NODE_ENV=test do not', async () => {
    expect(await registered({ NODE_ENV: 'development', SCHEDULED_JOBS: 'off' })).toBe(false);
    expect(await registered({ NODE_ENV: 'test', SCHEDULED_JOBS: undefined })).toBe(false);
  });
  it('the integration-test setup forces the switch off even if .env or the shell turns it on', async () => {
    process.env.SCHEDULED_JOBS = 'on';
    // Placeholders only where unset, so the setup's own checks pass without a .env (restored after).
    process.env.DATABASE_URL ??= 'postgresql://placeholder@localhost/none';
    process.env.REDIS_URL ??= 'redis://localhost:1';
    await jest.isolateModulesAsync(async () => {
      // The setup only reads .env when it exists and never turns this key back on.
      await import('../../../test/load-env');
    });
    expect(process.env.SCHEDULED_JOBS).toBe('off');
    expect(await registered({})).toBe(false);
  });

  it('when enabled, one idempotent scheduler at minute 7 hourly; the worker runs the hourly tick', async () => {
    const queue = { upsertJobScheduler: jest.fn().mockResolvedValue(undefined) };
    await new ExpirySweepScheduler(queue as unknown as Queue).onApplicationBootstrap();
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      EXPIRY_SCHEDULER_ID,
      { pattern: EXPIRY_SCHEDULE },
      expect.objectContaining({ name: EXPIRY_SCHEDULER_ID }),
    );
    expect(EXPIRY_SCHEDULE).toBe('7 * * * *');
    const sweep = { runDue: jest.fn().mockResolvedValue([]) };
    await new ExpirySweepProcessor(sweep as unknown as ExpirySweep).process();
    expect(sweep.runDue).toHaveBeenCalledTimes(1);
  });
});
