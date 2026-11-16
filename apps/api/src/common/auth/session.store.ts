import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../infra/redis/redis.constants';

/**
 * Refresh-token sessions in Redis as rt:{userId}:{sessionId} (AUTH-010). The value is the id (jti)
 * of the only refresh token currently valid for that session; rotation replaces it atomically.
 */
const ROTATE = `
local cur = redis.call('GET', KEYS[1])
if not cur then return 0 end
if cur ~= ARGV[1] then
  redis.call('DEL', KEYS[1])
  return -1
end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1
`;

export type RotateResult = 'rotated' | 'missing' | 'reused';

@Injectable()
export class SessionStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  static key(userId: string, sessionId: string): string {
    return `rt:${userId}:${sessionId}`;
  }

  async create(userId: string, sessionId: string, jti: string, ttlMs: number): Promise<void> {
    await this.redis.set(SessionStore.key(userId, sessionId), jti, 'PX', ttlMs);
  }

  /** Compare-and-set. A mismatching jti means an old token was replayed: the session is revoked. */
  async rotate(
    userId: string,
    sessionId: string,
    presentedJti: string,
    nextJti: string,
    ttlMs: number,
  ): Promise<RotateResult> {
    const r = (await this.redis.eval(
      ROTATE,
      1,
      SessionStore.key(userId, sessionId),
      presentedJti,
      nextJti,
      String(ttlMs),
    )) as number;
    return r === 1 ? 'rotated' : r === 0 ? 'missing' : 'reused';
  }

  async exists(userId: string, sessionId: string): Promise<boolean> {
    return (await this.redis.exists(SessionStore.key(userId, sessionId))) === 1;
  }

  async revoke(userId: string, sessionId: string): Promise<void> {
    await this.redis.del(SessionStore.key(userId, sessionId));
  }

  /** Logout from all devices (AUTH-008/010). */
  async revokeAll(userId: string): Promise<number> {
    let cursor = '0';
    let removed = 0;
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', `rt:${userId}:*`, 'COUNT', 200);
      cursor = next;
      if (keys.length) removed += await this.redis.del(...keys);
    } while (cursor !== '0');
    return removed;
  }
}
