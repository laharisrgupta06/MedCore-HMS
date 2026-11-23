import { HealthService, probe } from './health.service';

const make = (
  db: () => Promise<unknown>,
  redis: () => Promise<unknown>,
  queue: () => Promise<unknown>,
) =>
  new HealthService(
    { $queryRaw: () => db() } as never,
    { ping: redis } as never,
    { count: queue } as never,
  );

describe('HealthService', () => {
  it('reports ok when every dependency responds', async () => {
    const s = await make(
      async () => [1],
      async () => 'PONG',
      async () => 'PONG',
    ).check();
    expect(s).toMatchObject({ status: 'ok', db: 'up', redis: 'up', queue: 'up' });
  });

  it('reports degraded and names the failing dependency', async () => {
    const s = await make(
      async () => {
        throw new Error('ECONNREFUSED');
      },
      async () => 'PONG',
      async () => 'PONG',
    ).check();
    expect(s).toMatchObject({ status: 'degraded', db: 'down', redis: 'up', queue: 'up' });
  });

  it('treats a hung dependency as down after the timeout', async () => {
    expect(await probe(() => new Promise(() => undefined), 20)).toBe('down');
  });
});
