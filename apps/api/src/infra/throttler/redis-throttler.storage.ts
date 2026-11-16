import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';

/** Shape returned by ThrottlerStorage.increment (times in seconds, as the built-in storage returns). */
export interface ThrottlerRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Atomic fixed-window counter with block support. Returns [hits, hitTtlMs, blocked(0|1), blockTtlMs].
 * KEYS[1] = hit counter, KEYS[2] = block flag. ARGV = ttlMs, limit, blockDurationMs.
 */
export const THROTTLE_SCRIPT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  local hits = tonumber(redis.call('GET', KEYS[1]) or '0')
  return {hits, redis.call('PTTL', KEYS[1]), 1, blockTtl}
end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local hitTtl = redis.call('PTTL', KEYS[1])
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return {hits, hitTtl, 1, tonumber(ARGV[3])}
end
return {hits, hitTtl, 0, 0}
`;

const toSeconds = (ms: number): number => (ms > 0 ? Math.ceil(ms / 1000) : 0);

/** Redis-backed rate-limit counters (PRD section 03, caching strategy item 3). */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(
    private readonly redis: Pick<Redis, 'eval'>,
    private readonly prefix = 'medcore:throttle',
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerRecord> {
    const base = `${this.prefix}:${throttlerName}:${key}`;
    const result = (await this.redis.eval(
      THROTTLE_SCRIPT,
      2,
      `${base}:hits`,
      `${base}:blocked`,
      ttl,
      limit,
      blockDuration > 0 ? blockDuration : ttl,
    )) as [number, number, number, number];
    const [hits, hitTtlMs, blocked, blockTtlMs] = result;
    return {
      totalHits: hits,
      timeToExpire: toSeconds(hitTtlMs),
      isBlocked: blocked === 1,
      timeToBlockExpire: toSeconds(blockTtlMs),
    };
  }
}
