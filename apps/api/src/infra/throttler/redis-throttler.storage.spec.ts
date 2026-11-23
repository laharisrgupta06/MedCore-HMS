import { RedisThrottlerStorage, THROTTLE_SCRIPT } from './redis-throttler.storage';

describe('RedisThrottlerStorage', () => {
  it('runs the atomic script with namespaced keys and converts ms to seconds', async () => {
    const evalMock = jest.fn().mockResolvedValue([3, 59_500, 0, 0]);
    const storage = new RedisThrottlerStorage({ eval: evalMock } as never);
    const rec = await storage.increment('1.2.3.4', 60_000, 1000, 0, 'default');
    expect(evalMock).toHaveBeenCalledWith(
      THROTTLE_SCRIPT,
      2,
      'medcore:throttle:default:1.2.3.4:hits',
      'medcore:throttle:default:1.2.3.4:blocked',
      60_000,
      1000,
      60_000,
    );
    expect(rec).toEqual({ totalHits: 3, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 });
  });

  it('reports a blocked caller', async () => {
    const storage = new RedisThrottlerStorage({
      eval: jest.fn().mockResolvedValue([101, 1200, 1, 900_000]),
    } as never);
    expect(await storage.increment('k', 900_000, 100, 900_000, 'auth')).toEqual({
      totalHits: 101,
      timeToExpire: 2,
      isBlocked: true,
      timeToBlockExpire: 900,
    });
  });
});
