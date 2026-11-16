import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import type { SmsAdapter, SmsMessage } from './messaging.types';

export const DEV_SMS_INBOX_KEY = 'dev:sms:inbox';
const MAX_MESSAGES = 50;
const TTL_SECONDS = 24 * 60 * 60;

export interface DevSmsRecord extends SmsMessage {
  id: string;
  sentAt: string;
}

/**
 * Development-only SMS inbox (DEC-011). Messages are kept in Redis for 24 hours and shown by the
 * dev inbox endpoint. Startup validation refuses this adapter when NODE_ENV=production.
 */
@Injectable()
export class DevSmsInboxAdapter implements SmsAdapter {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async send(m: SmsMessage): Promise<void> {
    const record: DevSmsRecord = {
      id: randomUUID(),
      to: m.to,
      body: m.body,
      sentAt: new Date().toISOString(),
    };
    await this.redis
      .multi()
      .lpush(DEV_SMS_INBOX_KEY, JSON.stringify(record))
      .ltrim(DEV_SMS_INBOX_KEY, 0, MAX_MESSAGES - 1)
      .expire(DEV_SMS_INBOX_KEY, TTL_SECONDS)
      .exec();
  }

  async list(): Promise<DevSmsRecord[]> {
    const raw = await this.redis.lrange(DEV_SMS_INBOX_KEY, 0, MAX_MESSAGES - 1);
    return raw.map((r) => JSON.parse(r) as DevSmsRecord);
  }

  async clear(): Promise<void> {
    await this.redis.del(DEV_SMS_INBOX_KEY);
  }
}
