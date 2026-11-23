import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { SessionStore } from './session.store';

describe('SessionStore (rt:{userId}:{sessionId}, AUTH-010)', () => {
  let redis: Redis;
  let store: SessionStore;
  beforeEach(async () => {
    redis = new RedisMock() as unknown as Redis;
    await redis.flushall();
    store = new SessionStore(redis);
  });

  it('rotates only when the presented token id is current', async () => {
    await store.create('u1', 's1', 'j1', 60_000);
    expect(await redis.get('rt:u1:s1')).toBe('j1');
    expect(await store.rotate('u1', 's1', 'j1', 'j2', 60_000)).toBe('rotated');
    expect(await store.rotate('u1', 's1', 'j1', 'j3', 60_000)).toBe('reused');
    expect(await store.exists('u1', 's1')).toBe(false);
    expect(await store.rotate('u1', 's1', 'j2', 'j4', 60_000)).toBe('missing');
  });

  it('revokes all sessions of one user only', async () => {
    await store.create('u1', 's1', 'a', 60_000);
    await store.create('u1', 's2', 'b', 60_000);
    await store.create('u2', 's1', 'c', 60_000);
    expect(await store.revokeAll('u1')).toBe(2);
    expect(await store.exists('u2', 's1')).toBe(true);
  });
});
