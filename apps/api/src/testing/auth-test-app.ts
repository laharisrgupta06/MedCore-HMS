import { FIELD_CRYPTO } from '../infra/crypto/field-crypto';
import { DomainEvents } from '../common/events/domain-events';
import { PDF_JOBS, PdfRenderers, type PdfJob } from '../infra/pdf/pdf-jobs';
import { PdfService } from '../infra/pdf/pdf.service';
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
import { buildThrottlerOptions } from '../infra/throttler/throttler-options';
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
import { REMINDER_SCHEDULER } from '../modules/appointments/reminders';

export const TEST_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(64),
  JWT_REFRESH_SECRET: 'b'.repeat(64),
  EMR_ENCRYPTION_KEY: 'e'.repeat(64),
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
  reminders: { id: string; at: string }[];
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
  const reminders: { id: string; at: string }[] = [];
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
    DomainEvents,
    PdfService,
    PdfRenderers,
    // PDFs render inline in tests (the app uses the BullMQ pdf queue); failures surface in the test.
    {
      provide: PDF_JOBS,
      inject: [PdfRenderers],
      useFactory: (r: PdfRenderers) => ({ enqueue: (job: PdfJob) => r.run(job) }),
    },
    // Reversible stand-in for pgcrypto: ciphertext never equals the plain text (real cipher: T-EMR-INT).
    {
      provide: FIELD_CRYPTO,
      useValue: {
        encrypt: (v: readonly string[]) =>
          Promise.resolve(
            v.map((t) => new Uint8Array(Buffer.from(`enc:${Buffer.from(t).toString('base64')}`))),
          ),
        decrypt: (v: readonly Uint8Array[]) =>
          Promise.resolve(
            v.map((b) => Buffer.from(Buffer.from(b).toString().slice(4), 'base64').toString()),
          ),
      },
    },
    {
      provide: REMINDER_SCHEDULER,
      useValue: {
        schedule: (id: string, at: Date) => (
          reminders.push({ id, at: at.toISOString() }),
          Promise.resolve()
        ),
        cancel: (id: string) => (reminders.push({ id, at: 'cancelled' }), Promise.resolve()),
      },
    },
  ];
  const mod = await Test.createTestingModule({
    imports: [
      {
        module: TestInfraModule,
        global: true,
        providers: infra,
        exports: [
          REDIS_CLIENT,
          MAIL_ADAPTER,
          SMS_ADAPTER,
          REMINDER_SCHEDULER,
          FIELD_CRYPTO,
          DomainEvents,
          PdfService,
          PdfRenderers,
          PDF_JOBS,
        ],
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
  return { app, prisma, redis, emails, sms, reminders, tokenFor };
}

/** Extracts the 6-digit code from the most recent message, as a person reading Mailpit would. */
export function lastCode(messages: { text?: string; body?: string }[]): string {
  const m = messages.at(-1);
  const code = /\b(\d{6})\b/.exec(m?.text ?? m?.body ?? '')?.[1];
  if (!code) throw new Error('No code found in the last message');
  return code;
}
