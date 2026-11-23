import { scheduledJobsEnabled, validateEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://medcore:pw@localhost:5432/medcore',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(64),
  JWT_REFRESH_SECRET: 'b'.repeat(64),
  EMR_ENCRYPTION_KEY: 'e'.repeat(64),
  CORS_ORIGINS: 'http://localhost:3000, https://app.example.com',
};

describe('validateEnv', () => {
  it('accepts a valid configuration and applies defaults', () => {
    const env = validateEnv(valid);
    expect(env.API_PORT).toBe(3001);
    expect(env.NODE_ENV).toBe('development');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'https://app.example.com']);
    expect(env.THROTTLE_LIMIT).toBe(1000);
  });

  it('rejects JWT secrets shorter than 256 bits without printing the value', () => {
    const weak = 'tooshort-secret-value';
    expect(() => validateEnv({ ...valid, JWT_ACCESS_SECRET: weak })).toThrow(
      /JWT_ACCESS_SECRET: must be at least 32/,
    );
    try {
      validateEnv({ ...valid, JWT_ACCESS_SECRET: weak });
    } catch (e) {
      expect((e as Error).message).not.toContain(weak);
    }
  });

  it('rejects the .env.example placeholder secret', () => {
    expect(() =>
      validateEnv({
        ...valid,
        JWT_ACCESS_SECRET: 'replace-with-output-of-openssl-rand-hex-32-xxxxxxxx',
      }),
    ).toThrow(/placeholder/);
  });

  it('rejects identical access and refresh secrets', () => {
    expect(() => validateEnv({ ...valid, JWT_REFRESH_SECRET: valid.JWT_ACCESS_SECRET })).toThrow(
      /JWT_REFRESH_SECRET: must be different/,
    );
  });

  it('rejects missing and malformed URLs', () => {
    const { DATABASE_URL: _omit, ...rest } = valid;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ ...valid, REDIS_URL: 'http://localhost' })).toThrow(/REDIS_URL/);
  });

  it('rejects an empty CORS allow-list', () => {
    expect(() => validateEnv({ ...valid, CORS_ORIGINS: '' })).toThrow(/CORS_ORIGINS/);
  });

  it('refuses the local mail and SMS adapters in production (DEC-011)', () => {
    expect(() => validateEnv({ ...valid, NODE_ENV: 'production' })).toThrow(
      /SMS_PROVIDER: dev-inbox/,
    );
    expect(() => validateEnv({ ...valid, NODE_ENV: 'production' })).toThrow(/SMTP_HOST/);
    expect(() =>
      validateEnv({
        ...valid,
        NODE_ENV: 'production',
        SMS_PROVIDER: 'twilio',
        SMTP_HOST: 'smtp.example.com',
      }),
    ).toThrow(/TWILIO_ACCOUNT_SID: is required/);
    const prod = validateEnv({
      ...valid,
      NODE_ENV: 'production',
      SMTP_HOST: 'smtp.example.com',
      SMS_PROVIDER: 'twilio',
      TWILIO_ACCOUNT_SID: 'AC1',
      TWILIO_AUTH_TOKEN: 't',
      TWILIO_FROM_NUMBER: '+10000000000',
    });
    expect(prod.SMS_PROVIDER).toBe('twilio');
  });

  it('defaults the auth rate limit to 100 requests per 15 minutes (SEC-005)', () => {
    const env = validateEnv(valid);
    expect(env.AUTH_THROTTLE_LIMIT).toBe(100);
    expect(env.AUTH_THROTTLE_TTL_MS).toBe(900_000);
  });

  it('timed jobs: on by default, off under NODE_ENV=test, explicit SCHEDULED_JOBS wins (DEC-043)', () => {
    expect(scheduledJobsEnabled({ NODE_ENV: 'development' })).toBe(true); // pnpm dev
    expect(scheduledJobsEnabled({ NODE_ENV: 'production' })).toBe(true);
    expect(scheduledJobsEnabled({})).toBe(true);
    expect(scheduledJobsEnabled({ NODE_ENV: 'test' })).toBe(false);
    expect(scheduledJobsEnabled({ NODE_ENV: 'development', SCHEDULED_JOBS: 'off' })).toBe(false);
    expect(scheduledJobsEnabled({ NODE_ENV: 'test', SCHEDULED_JOBS: 'on' })).toBe(true);
    expect(validateEnv({ ...valid, SCHEDULED_JOBS: 'off' }).SCHEDULED_JOBS).toBe('off');
    expect(() => validateEnv({ ...valid, SCHEDULED_JOBS: 'yes' })).toThrow(/SCHEDULED_JOBS/);
  });
});
