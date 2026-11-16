import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor';
import { createValidationPipe } from './common/pipes/validation';

export const API_PREFIX = 'api';
export const DOCS_PATH = `${API_PREFIX}/docs`;

export interface AppSetupOptions {
  corsOrigins: string[];
  enableSwagger?: boolean;
}

/** Applies every cross-cutting concern. Shared by main.ts and the tests so they run the same stack. */
export function configureApp(app: INestApplication, options: AppSetupOptions): void {
  const http = app as NestExpressApplication;
  http.set('trust proxy', 1); // behind Nginx: real client IP for rate limiting
  http.disable('x-powered-by');

  // Helmet with all recommended headers. Swagger UI needs inline scripts, so only /api/docs relaxes CSP.
  const strict = helmet();
  const docs = helmet({ contentSecurityPolicy: false });
  app.use((req: Request, res: Response, next: NextFunction) =>
    req.path.startsWith(`/${DOCS_PATH}`) ? docs(req, res, next) : strict(req, res, next),
  );
  app.use(cookieParser());
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) =>
      cb(null, !origin || options.corsOrigins.includes(origin)),
    credentials: true,
  });

  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.enableShutdownHooks();

  if (options.enableSwagger !== false) {
    const doc = new DocumentBuilder()
      .setTitle('MedCore HMS API')
      .setDescription(
        'REST API for MedCore HMS. All responses use the standard envelope { success, data | error }.',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(DOCS_PATH, app, SwaggerModule.createDocument(app, doc), {
      jsonDocumentUrl: `${DOCS_PATH}/openapi.json`,
    });
  }
}
