import { validateEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://medcore:pw@localhost:5432/medcore',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(64),
  JWT_REFRESH_SECRET: 'b'.repeat(64),
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
});
