// Isolated end-to-end environment (DEC-061). Everything the E2E stack needs is derived from the
// repository-root .env, then overridden so that it can never reach the development stack:
//   database  medcore_e2e (a constant, never read from configuration)
//   redis     database index 1 (development uses the index in REDIS_URL, normally 0)
//   ports     web 3100, API 3101 (development uses 3000 and 3001)
//   files     apps/api/var/storage-e2e, Next.js build folder .next-e2e
// Nothing here prints a secret: errors name settings, never their values.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const E2E_DB = 'medcore_e2e';
export const E2E_REDIS_DB = 1;
export const E2E_WEB_PORT = 3100;
export const E2E_API_PORT = 3101;

/** Database name in a postgres:// URL. */
export function databaseName(url) {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

/** Throws unless the URL names exactly the E2E database. Used before every E2E database action. */
export function assertE2eDatabaseUrl(url) {
  const name = databaseName(url);
  if (name !== E2E_DB) {
    throw new Error(`Refusing to run: the database is "${name}", not "${E2E_DB}".`);
  }
}

/**
 * The E2E environment, derived from the development settings. `source` defaults to the root
 * .env file; tests pass an object instead.
 */
export function e2eEnv(source) {
  const base = source ?? readRootEnv();
  for (const key of ['DATABASE_URL', 'REDIS_URL', 'POSTGRES_DB']) {
    if (!base[key])
      throw new Error(`${key} is not set in .env; the E2E stack derives its settings from it.`);
  }
  if (base.POSTGRES_DB === E2E_DB || databaseName(base.DATABASE_URL) === E2E_DB) {
    throw new Error(
      `The development database must not be named "${E2E_DB}"; that name is reserved for E2E runs.`,
    );
  }
  if (base.NODE_ENV === 'production')
    throw new Error('Refusing to build an E2E environment from production settings.');

  const db = new URL(base.DATABASE_URL);
  db.pathname = `/${E2E_DB}`;
  const redis = new URL(base.REDIS_URL);
  const devRedisDb = Number(redis.pathname.replace(/^\//, '') || 0);
  if (devRedisDb === E2E_REDIS_DB) {
    throw new Error(
      `Development REDIS_URL already uses Redis database ${E2E_REDIS_DB}, which is reserved for E2E runs.`,
    );
  }
  redis.pathname = `/${E2E_REDIS_DB}`;

  const env = {
    ...base,
    NODE_ENV: 'development',
    MEDCORE_E2E: '1',
    DATABASE_URL: db.toString(),
    REDIS_URL: redis.toString(),
    API_PORT: String(E2E_API_PORT),
    API_INTERNAL_URL: `http://localhost:${E2E_API_PORT}`,
    WEB_APP_URL: `http://localhost:${E2E_WEB_PORT}`,
    CORS_ORIGINS: `http://localhost:${E2E_WEB_PORT}`,
    FILE_STORAGE_DIR: 'var/storage-e2e',
    NEXT_DIST_DIR: '.next-e2e',
    // Development SMS inbox, never a real SMS provider, in E2E runs.
    SMS_PROVIDER: 'dev-inbox',
  };
  assertE2eDatabaseUrl(env.DATABASE_URL);
  return env;
}

function readRootEnv() {
  const file = resolve(ROOT, '.env');
  if (!existsSync(file)) throw new Error('No .env file in the repository root.');
  return parseEnv(readFileSync(file, 'utf8'));
}
