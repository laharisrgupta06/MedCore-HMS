import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

/**
 * Integration tests read the repository-root .env (created from .env.example).
 *
 * The values are assigned to `process.env` as seen by the test file. `process.loadEnvFile()` must
 * not be used here: it writes to Node's real environment, while Jest gives every test file its own
 * copy of `process.env`, so the first suite to run (unless it boots AppModule, whose ConfigModule
 * loads .env itself) would see no DATABASE_URL. Variables already set in the shell win.
 */
const envFile = resolve(__dirname, '../../../.env');
if (existsSync(envFile)) {
  const parsed = parseEnv(readFileSync(envFile, 'utf8')) as Record<string, string>;
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// Timed jobs never run inside integration tests, whatever .env or the shell says. Tests call
// ExpirySweep explicitly for the hospitals they create (DEC-043).
process.env.SCHEDULED_JOBS = 'off';

for (const key of ['DATABASE_URL', 'REDIS_URL']) {
  if (!process.env[key]) {
    throw new Error(
      `Integration tests need ${key}: create the repository-root .env from .env.example (value not shown).`,
    );
  }
}

/**
 * Isolated integration database (Phase 13, like the E2E stack in DEC-061). Locally the tests never
 * use the development database: the URLs from .env are rewritten to the disposable database
 * `medcore_int` (a constant), Redis database 2 and their own file folder. Create it with
 * `pnpm int:db:prepare`. In CI (CI=true) the workflow's own throwaway database is used as given.
 * Every run checks the final database name and refuses anything else, before any test connects.
 * Errors name settings, never their values.
 */
export const INT_DB = 'medcore_int';
export const INT_REDIS_DB = 2;
const CI_DB = 'medcore_ci';
const dbName = (url: string) => decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));

if (process.env.NODE_ENV === 'production')
  throw new Error('Refusing to run integration tests with NODE_ENV=production.');
if (process.env.CI !== 'true') {
  const db = new URL(process.env.DATABASE_URL!);
  if (dbName(db.toString()) === INT_DB || process.env.POSTGRES_DB === INT_DB)
    throw new Error(
      `The development database must not be named "${INT_DB}"; that name is reserved for integration tests.`,
    );
  db.pathname = `/${INT_DB}`;
  process.env.DATABASE_URL = db.toString();
  const redis = new URL(process.env.REDIS_URL!);
  if (Number(redis.pathname.replace(/^\//, '') || 0) === INT_REDIS_DB)
    throw new Error(
      `Development REDIS_URL already uses Redis database ${INT_REDIS_DB}, reserved for integration tests.`,
    );
  redis.pathname = `/${INT_REDIS_DB}`;
  process.env.REDIS_URL = redis.toString();
  process.env.FILE_STORAGE_DIR = 'var/storage-int';
}
const finalDb = dbName(process.env.DATABASE_URL!);
if (!(finalDb === INT_DB || (process.env.CI === 'true' && finalDb === CI_DB)))
  throw new Error(
    `Refusing to run integration tests: the database is "${finalDb}", not "${INT_DB}".`,
  );
