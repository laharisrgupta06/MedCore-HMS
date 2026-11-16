import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { validateEnv, type Env } from './config/env';
import { PrismaModule } from './infra/prisma/prisma.module';
import { REDIS_CLIENT } from './infra/redis/redis.constants';
import { RedisModule } from './infra/redis/redis.module';
import { RedisThrottlerStorage } from './infra/throttler/redis-throttler.storage';
import { HealthModule } from './modules/health/health.module';

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
      useFactory: (config: ConfigService<Env, true>, redis: Redis) => ({
        // General API limit (PRD section 10: 1000 req/min). The stricter auth limit
        // (100 req / 15 min per IP) is applied on the auth controller in Phase 1.
        throttlers: [
          {
            name: 'default',
            ttl: config.get('THROTTLE_TTL_MS', { infer: true }),
            limit: config.get('THROTTLE_LIMIT', { infer: true }),
          },
        ],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
