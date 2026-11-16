import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { parseRedisUrl } from '../redis/redis-url';
import { SYSTEM_QUEUE } from './queue.constants';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: parseRedisUrl(config.get('REDIS_URL', { infer: true })),
        prefix: 'medcore',
      }),
    }),
    BullModule.registerQueue({ name: SYSTEM_QUEUE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
