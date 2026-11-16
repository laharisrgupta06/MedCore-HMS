import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { RedisThrottlerStorage } from '../src/infra/throttler/redis-throttler.storage';

/** Requires: docker compose services running and a valid root .env. */
describe('Phase 0 integration: real PostgreSQL and Redis', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app, { corsOrigins: ['http://localhost:3000'] });
    await app.init();
  });
  afterAll(() => app.close());

  it('GET /api/health reports PostgreSQL, Redis and the queue as up', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ status: 'ok', db: 'up', redis: 'up', queue: 'up' });
  });

  it('Redis throttler storage counts hits and blocks over the limit', async () => {
    const redis = new Redis(process.env.REDIS_URL as string);
    const storage = new RedisThrottlerStorage(redis, `medcore:test:${Date.now()}`);
    const first = await storage.increment('ip', 5_000, 2, 5_000, 't');
    await storage.increment('ip', 5_000, 2, 5_000, 't');
    const third = await storage.increment('ip', 5_000, 2, 5_000, 't');
    expect(first).toMatchObject({ totalHits: 1, isBlocked: false });
    expect(third).toMatchObject({ totalHits: 3, isBlocked: true });
    expect(third.timeToBlockExpire).toBeGreaterThan(0);
    await redis.quit();
  });
});
