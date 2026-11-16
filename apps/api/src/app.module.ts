import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { ExecutionContext } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { validateEnv, type Env } from './config/env';
import { PrismaModule } from './infra/prisma/prisma.module';
import { REDIS_CLIENT } from './infra/redis/redis.constants';
import { RedisModule } from './infra/redis/redis.module';
import { RedisThrottlerStorage } from './infra/throttler/redis-throttler.storage';
import { AuthCoreModule } from './common/auth/auth-core.module';
import { CsrfGuard } from './common/auth/csrf.guard';
import { AUTH_RATE_LIMIT } from './common/auth/decorators';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { RolesGuard } from './common/auth/roles.guard';
import { MessagingModule } from './infra/messaging/messaging.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';

/** True when the route or its controller carries @AuthRateLimit(). */
export function isAuthRateLimited(ctx: ExecutionContext): boolean {
  return Boolean(
    Reflect.getMetadata(AUTH_RATE_LIMIT, ctx.getHandler()) ??
    Reflect.getMetadata(AUTH_RATE_LIMIT, ctx.getClass()),
  );
}

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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      // Single .env at the repository root; the API runs from apps/api.
      envFilePath: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')],
    }),
    PrismaModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, REDIS_CLIENT],
      useFactory: buildThrottlerOptions,
    }),
    MessagingModule.register(),
    AuditModule,
    AuthCoreModule,
    HealthModule,
    AuthModule,
  ],
  // Order matters: rate limit, then CSRF, then authentication, then roles.
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: CsrfGuard },
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
  ],
})
export class AppModule {}
