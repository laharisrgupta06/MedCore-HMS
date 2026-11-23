import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { DevSmsInboxAdapter } from './dev-sms-inbox.adapter';
import { devSmsInboxEnabled } from './messaging.module';

describe('Development SMS inbox (DEC-011)', () => {
  it('stores the newest messages first and can be cleared', async () => {
    const redis = new RedisMock() as unknown as Redis;
    await redis.flushall();
    const inbox = new DevSmsInboxAdapter(redis);
    await inbox.send({ to: '+911', body: 'first' });
    await inbox.send({ to: '+912', body: 'second' });
    const list = await inbox.list();
    expect(list.map((m) => m.body)).toEqual(['second', 'first']);
    expect(list[0]).toMatchObject({ id: expect.any(String), sentAt: expect.any(String) });
    await inbox.clear();
    expect(await inbox.list()).toEqual([]);
  });

  it('is only routed outside production with the dev-inbox provider', () => {
    expect(devSmsInboxEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(devSmsInboxEnabled({ NODE_ENV: 'development', SMS_PROVIDER: 'twilio' })).toBe(false);
    expect(devSmsInboxEnabled({ NODE_ENV: 'production', SMS_PROVIDER: 'dev-inbox' })).toBe(false);
  });
});
