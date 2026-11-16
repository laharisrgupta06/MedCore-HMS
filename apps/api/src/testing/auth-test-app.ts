/** Builds the auth HTTP stack for unit tests with in-memory Prisma and Redis (no external services). */
import { randomUUID } from 'node:crypto';
import { INestApplication, Module } from '@nestjs/common';
import type { Role } from '@medcore/types';
import type { User } from '@prisma/client';
import { SessionStore } from '../common/auth/session.store';
import { TokenService } from '../common/auth/token.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { buildThrottlerOptions } from '../app.module';
import { configureApp } from '../app.setup';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthCoreModule } from '../common/auth/auth-core.module';
import { GLOBAL_PIPELINE } from '../common/global-pipeline';
import { TenancyModule } from '../common/tenancy/tenancy.module';
import { validateEnv } from '../config/env';
import type { EmailMessage, SmsMessage } from '../infra/messaging/messaging.types';
import { MAIL_ADAPTER, SMS_ADAPTER } from '../infra/messaging/messaging.types';
import { PrismaModule } from '../infra/prisma/prisma.module';
import { PrismaService } from '../infra/prisma/prisma.service';
import { REDIS_CLIENT } from '../infra/redis/redis.constants';
import { AuditModule } from '../modules/audit/audit.module';
import { AuthModule } from '../modules/auth/auth.module';
import { StorageModule } from '../infra/storage/storage.service';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakePrisma } from './fake-prisma';

export const TEST_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(64),
  JWT_REFRESH_SECRET: 'b'.repeat(64),
  CORS_ORIGINS: 'http://localhost:3000',
  FILE_STORAGE_DIR: join(tmpdir(), 'medcore-test-storage'),
};

export interface AuthTestApp {
  app: INestApplication;
  /** Signs in a fixture user without the HTTP login flow: a live session and an access token. */
  tokenFor(user: Pick<User, 'id' | 'role' | 'hospitalId'>): Promise<string>;
  prisma: FakePrisma;
  redis: Redis;
  emails: EmailMessage[];
  sms: SmsMessage[];
}

@Module({})
class TestInfraModule {}

export async function createAuthTestApp(
  env: Record<string, string> = {},
  extra: { controllers?: unknown[]; modules?: unknown[]; providers?: unknown[] } = {},
): Promise<AuthTestApp> {
  const prisma = new FakePrisma();
  const redis = new RedisMock() as unknown as Redis;
  await redis.flushall();
  const emails: EmailMessage[] = [];
  const sms: SmsMessage[] = [];
  const infra = [
    { provide: REDIS_CLIENT, useValue: redis },
    {
      provide: MAIL_ADAPTER,
      useValue: { send: (m: EmailMessage) => (emails.push(m), Promise.resolve()) },
    },
    {
      provide: SMS_ADAPTER,
      useValue: { send: (m: SmsMessage) => (sms.push(m), Promise.resolve()) },
    },
  ];
  const mod = await Test.createTestingModule({
    imports: [
      {
        module: TestInfraModule,
        global: true,
        providers: infra,
        exports: [REDIS_CLIENT, MAIL_ADAPTER, SMS_ADAPTER],
      },
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        ignoreEnvVars: true,
        validate: () => validateEnv({ ...TEST_ENV, ...env }),
      }),
      PrismaModule,
      ThrottlerModule.forRootAsync({
        inject: [ConfigService, REDIS_CLIENT],
        useFactory: buildThrottlerOptions,
      }),
      AuditModule,
      AuthCoreModule,
      TenancyModule,
      StorageModule,
      AuthModule,
      ...((extra.modules ?? []) as never[]),
    ],
    controllers: (extra.controllers ?? []) as never[],
    providers: [...GLOBAL_PIPELINE, ...((extra.providers ?? []) as never[])],
  })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .compile();
  const app = mod.createNestApplication();
  configureApp(app, { corsOrigins: ['http://localhost:3000'], enableSwagger: false });
  await app.init();
  const tokens = app.get(TokenService);
  const sessions = app.get(SessionStore);
  const tokenFor = async (u: Pick<User, 'id' | 'role' | 'hospitalId'>) => {
    const sid = randomUUID();
    await sessions.create(u.id, sid, randomUUID(), 60_000);
    return tokens.signAccess({ sub: u.id, sid, role: u.role as Role, hid: u.hospitalId });
  };
  return { app, prisma, redis, emails, sms, tokenFor };
}

/** Extracts the 6-digit code from the most recent message, as a person reading Mailpit would. */
export function lastCode(messages: { text?: string; body?: string }[]): string {
  const m = messages.at(-1);
  const code = /\b(\d{6})\b/.exec(m?.text ?? m?.body ?? '')?.[1];
  if (!code) throw new Error('No code found in the last message');
  return code;
}
