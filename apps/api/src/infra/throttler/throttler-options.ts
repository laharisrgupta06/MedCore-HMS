import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import type { Env } from '../../config/env';

import { AUTH_RATE_LIMIT } from '../../common/auth/decorators';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/** True when the route or its controller carries @AuthRateLimit(). */
export function isAuthRateLimited(ctx: ExecutionContext): boolean {
  return Boolean(
    Reflect.getMetadata(AUTH_RATE_LIMIT, ctx.getHandler()) ??
    Reflect.getMetadata(AUTH_RATE_LIMIT, ctx.getClass()),
  );
}

/** Kept outside AppModule so tests can build the throttler without loading AppModule's .env config. */
/** PRD SEC-005: 1000 req/min on the API and 100 req / 15 min per IP on auth endpoints. */
export function buildThrottlerOptions(
  config: ConfigService<Env, true>,
  redis: Redis,
): ThrottlerModuleOptions {
  return {
    throttlers: [
      {
        name: 'default',
        ttl: config.get('THROTTLE_TTL_MS', { infer: true }),
        limit: config.get('THROTTLE_LIMIT', { infer: true }),
      },
      {
        name: 'auth',
        ttl: config.get('AUTH_THROTTLE_TTL_MS', { infer: true }),
        limit: config.get('AUTH_THROTTLE_LIMIT', { infer: true }),
        skipIf: (ctx: ExecutionContext) => !isAuthRateLimited(ctx),
      },
    ],
    storage: new RedisThrottlerStorage(redis),
  };
}
