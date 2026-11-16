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
  })
  .superRefine((env, ctx) => {
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'must be different from JWT_ACCESS_SECRET',
      });
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
