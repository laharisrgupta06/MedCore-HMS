// E2E database lifecycle (DEC-061). Usage from the repository root:
//   node scripts/e2e/db.mjs prepare   drop and recreate medcore_e2e, apply migrations, seed
//   node scripts/e2e/db.mjs migrate   apply pending migrations to medcore_e2e only
//   node scripts/e2e/db.mjs seed      (re)seed medcore_e2e; safe to repeat
// The only database this script ever drops is the constant E2E_DB, through the PostgreSQL
// maintenance database. It never connects to, migrates or seeds the development database.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { passwordProblem } from './check.mjs';
import { E2E_DB, ROOT, assertE2eDatabaseUrl, e2eEnv } from './env.mjs';

const env = e2eEnv();
const API = resolve(ROOT, 'apps/api');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env }, ...opts });
  if (r.status !== 0) {
    console.error(`Step failed: ${cmd} ${args[0] ?? ''} (exit ${r.status ?? r.signal}).`);
    process.exit(1);
  }
}

function psqlMaintenance(sql) {
  // Runs inside the development PostgreSQL container, connected to the "postgres" maintenance
  // database, never to the development database itself.
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
}

function recreate() {
  if (env.POSTGRES_DB === E2E_DB) throw new Error('Development database is the E2E database name.');
  psqlMaintenance(`DROP DATABASE IF EXISTS ${E2E_DB} WITH (FORCE)`);
  psqlMaintenance(`CREATE DATABASE ${E2E_DB}`);
}

function migrate() {
  assertE2eDatabaseUrl(env.DATABASE_URL);
  run(process.execPath, ['./node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: API,
  });
}

/** Checks that cannot fail half way: run before anything is dropped. */
function precheck() {
  const problem = passwordProblem(env.E2E_PASSWORD);
  if (problem) {
    console.error(`${problem}\nNothing was changed.`);
    process.exit(1);
  }
}

function seed() {
  assertE2eDatabaseUrl(env.DATABASE_URL);
  precheck();
  run('pnpm', ['exec', 'nest', 'build'], { cwd: API });
  run(process.execPath, ['dist/cli/seed-e2e.js'], { cwd: API });
}

const step = process.argv[2];
if (step === 'prepare') {
  precheck();
  process.stdout.write(
    `Recreating ${E2E_DB} (the disposable E2E database only; your ${env.POSTGRES_DB} database is not touched).\n`,
  );
  recreate();
  migrate();
  seed();
} else if (step === 'migrate') migrate();
else if (step === 'seed') seed();
else {
  console.error('Usage: node scripts/e2e/db.mjs prepare | migrate | seed');
  process.exit(2);
}
process.stdout.write(`E2E database ${E2E_DB}: ${step} done.\n`);
