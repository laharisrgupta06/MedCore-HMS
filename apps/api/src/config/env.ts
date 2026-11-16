import { z } from 'zod';

/** JWT secrets must be at least 256 bits (PRD section 10: "Minimum 256-bit random secret"). */
const secret = z
  .string()
  .min(32, 'must be at least 32 characters (256-bit). Generate one with: openssl rand -hex 32')
  .refine(
    (v) => !v.toLowerCase().includes('replace-with'),
    'still contains the .env.example placeholder',
  );

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgresql:// connection URL'),
    REDIS_URL: z.string().regex(/^rediss?:\/\//, 'must be a redis:// or rediss:// URL'),
    JWT_ACCESS_SECRET: secret,
    JWT_REFRESH_SECRET: secret,
    CORS_ORIGINS: z
      .string()
      .min(1, 'must list at least one allowed origin')
      .transform((s) =>
        s
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),
    SENTRY_DSN: z.string().default(''),
    THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(1000),
    /** Auth endpoints: 100 requests per 15 minutes per IP (PRD SEC-005). */
    AUTH_THROTTLE_TTL_MS: z.coerce.number().int().positive().default(900_000),
    AUTH_THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
    /** Public URL of the web app, used in password-reset links. */
    WEB_APP_URL: z.url().default('http://localhost:3000'),
    /** Outgoing email. Development uses Mailpit on localhost:1025 (DEC-011). */
    SMTP_HOST: z.string().min(1).default('localhost'),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    SMTP_USER: z.string().default(''),
    SMTP_PASS: z.string().default(''),
    MAIL_FROM: z.string().min(3).default('MedCore HMS <no-reply@medcore.local>'),
    /** Local file storage root (development; S3-compatible storage is configured at deployment). */
    FILE_STORAGE_DIR: z.string().min(1).default('var/storage'),
    /** SMS delivery: "dev-inbox" (local only, DEC-011) or "twilio". */
    SMS_PROVIDER: z.enum(['dev-inbox', 'twilio']).default('dev-inbox'),
    TWILIO_ACCOUNT_SID: z.string().default(''),
    TWILIO_AUTH_TOKEN: z.string().default(''),
    TWILIO_FROM_NUMBER: z.string().default(''),
  })
  .superRefine((env, ctx) => {
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'must be different from JWT_ACCESS_SECRET',
      });
    }
    if (env.NODE_ENV === 'production') {
      // DEC-011: local delivery adapters can never be selected in production.
      if (env.SMS_PROVIDER === 'dev-inbox') {
        ctx.addIssue({
          code: 'custom',
          path: ['SMS_PROVIDER'],
          message: 'dev-inbox is for local development only; use twilio in production',
        });
      }
      if (['localhost', '127.0.0.1', 'mailpit'].includes(env.SMTP_HOST)) {
        ctx.addIssue({
          code: 'custom',
          path: ['SMTP_HOST'],
          message: 'must be a real mail server in production (Mailpit is development only)',
        });
      }
    }
    if (env.SMS_PROVIDER === 'twilio') {
      for (const key of [
        'TWILIO_ACCOUNT_SID',
        'TWILIO_AUTH_TOKEN',
        'TWILIO_FROM_NUMBER',
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'is required when SMS_PROVIDER=twilio',
          });
        }
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Validates environment variables at startup and refuses to boot on any problem.
 * Error messages name the variable and the rule, never the value.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
