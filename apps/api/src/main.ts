import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as Sentry from '@sentry/node';
import { AppModule } from './app.module';
import { configureApp, DOCS_PATH } from './app.setup';
import { AppLogger } from './common/logger/app-logger';
import type { Env } from './config/env';

async function bootstrap(): Promise<void> {
  // rawBody keeps the exact bytes of each request, so payment webhooks can be verified (task 8-B6).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  app.useLogger(new AppLogger());
  const config = app.get(ConfigService<Env, true>);

  const dsn = config.get('SENTRY_DSN', { infer: true });
  if (dsn)
    Sentry.init({ dsn, environment: config.get('NODE_ENV', { infer: true }), tracesSampleRate: 0 });

  configureApp(app, { corsOrigins: config.get('CORS_ORIGINS', { infer: true }) });

  const port = config.get('API_PORT', { infer: true });
  await app.listen(port);
  Logger.log(`API listening on port ${port}; docs at /${DOCS_PATH}`, 'Bootstrap');
}

void bootstrap();
