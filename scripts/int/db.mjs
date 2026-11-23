// Integration-test database lifecycle (Phase 13). Usage from the repository root:
//   node scripts/int/db.mjs prepare   drop and recreate medcore_int, then apply the committed migrations
//   node scripts/int/db.mjs migrate   apply pending committed migrations to medcore_int only
// The only database this script ever drops is the constant INT_DB, through the PostgreSQL
// maintenance database of the development container. It never connects to, migrates or changes
// the development database. Proposals under prisma/proposed are never applied.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { ROOT, databaseName } from '../e2e/env.mjs';

export const INT_DB = 'medcore_int';

/** Development settings with the database switched to INT_DB. Refuses unsafe inputs. */
export function intEnv(source) {
  const base = source ?? parseEnv(readFileSync(resolve(ROOT, '.env'), 'utf8'));
  for (const key of ['DATABASE_URL', 'POSTGRES_DB'])
    if (!base[key])
      throw new Error(`${key} is not set in .env; the integration database is derived from it.`);
  if (base.NODE_ENV === 'production')
    throw new Error('Refusing to prepare an integration database from production settings.');
  if (base.POSTGRES_DB === INT_DB || databaseName(base.DATABASE_URL) === INT_DB)
    throw new Error(
      `The development database must not be named "${INT_DB}"; that name is reserved for integration tests.`,
    );
  const db = new URL(base.DATABASE_URL);
  db.pathname = `/${INT_DB}`;
  const env = { ...base, DATABASE_URL: db.toString() };
  if (databaseName(env.DATABASE_URL) !== INT_DB)
    throw new Error('Internal error: not the integration database.');
  return env;
}

function main() {
  if (!existsSync(resolve(ROOT, '.env'))) throw new Error('No .env file in the repository root.');
  const env = intEnv();
  const run = (cmd, args, opts = {}) => {
    const r = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env }, ...opts });
    if (r.status !== 0) {
      console.error(`Step failed: ${cmd} ${args[0] ?? ''} (exit ${r.status ?? r.signal}).`);
      process.exit(1);
    }
  };
  const maintenance = (sql) =>
    run(
      'docker',
      [
        'compose',
        '-f',
        'docker/compose.dev.yml',
        '--env-file',
        '.env',
        'exec',
        '-T',
        'postgres',
        'sh',
        '-c',
        `psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -c '${sql}'`,
      ],
      { cwd: ROOT },
    );
  const migrate = () =>
    run(process.execPath, ['./node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
      cwd: resolve(ROOT, 'apps/api'),
    });

  const step = process.argv[2];
  if (step === 'prepare') {
    process.stdout.write(
      `Recreating ${INT_DB} (the disposable integration database only; your ${env.POSTGRES_DB} database is not touched).\n`,
    );
    maintenance(`DROP DATABASE IF EXISTS ${INT_DB} WITH (FORCE)`);
    maintenance(`CREATE DATABASE ${INT_DB}`);
    migrate();
  } else if (step === 'migrate') migrate();
  else {
    console.error('Usage: node scripts/int/db.mjs prepare | migrate');
    process.exit(2);
  }
  process.stdout.write(`Integration database ${INT_DB}: ${step} done.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(ROOT, 'scripts/int/db.mjs')) main();
