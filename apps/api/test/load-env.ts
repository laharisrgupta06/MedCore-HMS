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

for (const key of ['DATABASE_URL', 'REDIS_URL']) {
  if (!process.env[key]) {
    throw new Error(
      `Integration tests need ${key}: create the repository-root .env from .env.example (value not shown).`,
    );
  }
}
