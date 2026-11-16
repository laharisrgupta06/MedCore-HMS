import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { DependencyStatus, HealthStatus } from '@medcore/types';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SYSTEM_QUEUE } from '../../infra/queue/queue.constants';
import { REDIS_CLIENT } from '../../infra/redis/redis.constants';

export const PROBE_TIMEOUT_MS = 2000;

export async function probe(
  check: () => Promise<unknown>,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<DependencyStatus> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectQueue(SYSTEM_QUEUE) private readonly queue: Queue,
  ) {}

  async check(): Promise<HealthStatus> {
    const [db, redis, queue] = await Promise.all([
      // Tagged-template $queryRaw is parameterised; this constant connectivity probe is the only raw query.
      probe(() => this.prisma.$queryRaw`SELECT 1`),
      probe(() => this.redis.ping()),
      // Public BullMQ query: a real round trip through the queue's own Redis connection.
      probe(() => this.queue.count()),
    ]);
    return {
      status: db === 'up' && redis === 'up' && queue === 'up' ? 'ok' : 'degraded',
      db,
      redis,
      queue,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
