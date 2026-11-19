// Read-only preflight for the isolated E2E stack (DEC-061). Run by `pnpm test:e2e` before
// Playwright starts any server, and on its own with `pnpm e2e:check`.
//
// It only reads: TCP connection tests, `redis-cli PING`, and SELECT queries against the PostgreSQL
// maintenance database ("postgres", for the list of databases) and against medcore_e2e. It never
// connects to the development database and never changes anything. It prints names and states,
// never a password or a connection string.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { E2E_API_PORT, E2E_DB, E2E_REDIS_DB, E2E_WEB_PORT, ROOT, e2eEnv } from './env.mjs';

/** Same rules as checkPassword in @medcore/types (parity is tested in env.test.mjs). */
export const E2E_PASSWORD_EMAIL = 'e2e-super-admin@medcore.test';
export function passwordProblem(password, email = E2E_PASSWORD_EMAIL) {
  if (typeof password !== 'string' || password.length === 0)
    return 'E2E_PASSWORD is not set in the repository-root .env.';
  if (password.length < 10 || password.length > 128)
    return 'E2E_PASSWORD must be 10 to 128 characters.';
  if (!/^(?=.*[A-Za-z])(?=.*\d).+$/.test(password))
    return 'E2E_PASSWORD must contain at least one letter and one number.';
  if (password.trim().toLowerCase() === email) return 'E2E_PASSWORD must not be an email address.';
  return null;
}

const COMPOSE = ['compose', '-f', 'docker/compose.dev.yml', '--env-file', '.env'];

function docker(args) {
  const r = spawnSync('docker', [...COMPOSE, ...args], { cwd: ROOT, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), missing: r.error?.code === 'ENOENT' };
}

/** A SELECT run with psql inside the PostgreSQL container. `db` is "postgres" or medcore_e2e only. */
function select(db, sql) {
  if (db !== 'postgres' && db !== E2E_DB)
    throw new Error('check.mjs only reads postgres or medcore_e2e');
  return docker([
    'exec',
    '-T',
    'postgres',
    'sh',
    '-c',
    `psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d ${db} -c "${sql}"`,
  ]);
}

function tcp(host, port, ms = 2000) {
  return new Promise((done) => {
    const s = createConnection({ host, port });
    const end = (ok) => (s.destroy(), done(ok));
    s.setTimeout(ms, () => end(false));
    s.once('connect', () => end(true));
    s.once('error', () => end(false));
  });
}

export function pendingMigrations(applied) {
  const dir = resolve(ROOT, 'apps/api/prisma/migrations');
  const all = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const done = new Set(applied);
  return all.filter((m) => !done.has(m));
}

export async function runChecks() {
  const results = [];
  const ok = (name) => results.push({ ok: true, name });
  const fail = (name, fix) => results.push({ ok: false, name, fix });
  const stop = () => results;

  let env;
  try {
    env = e2eEnv();
    ok('.env found; E2E settings derived (database medcore_e2e, Redis database 1)');
  } catch (e) {
    fail('.env', e.message);
    return stop();
  }
  const pw = passwordProblem(env.E2E_PASSWORD);
  if (pw)
    fail(
      'E2E_PASSWORD',
      `${pw} See the setup steps: add a line E2E_PASSWORD=... to .env (value never shared).`,
    );
  else ok('E2E_PASSWORD is set and meets the password rules');

  const ps = docker(['ps', '--status', 'running', '--services']);
  if (ps.missing) {
    fail('Docker', 'The docker command was not found. Install and start Docker Desktop.');
    return stop();
  }
  const running = new Set(ps.out.split('\n').filter(Boolean));
  for (const svc of ['postgres', 'redis']) {
    if (running.has(svc)) ok(`Docker service ${svc} is running`);
    else
      fail(`Docker service ${svc}`, 'Not running. Start Docker Desktop, then run: pnpm infra:up');
  }
  if (!running.has('postgres') || !running.has('redis')) return stop();

  const db = new URL(env.DATABASE_URL);
  const rd = new URL(env.REDIS_URL);
  if (await tcp(db.hostname, Number(db.port || 5432)))
    ok(`PostgreSQL accepts connections on ${db.hostname}:${db.port || 5432}`);
  else
    fail(
      'PostgreSQL port',
      `Nothing answers on ${db.hostname}:${db.port || 5432}. Run: pnpm infra:up`,
    );
  if (await tcp(rd.hostname, Number(rd.port || 6379)))
    ok(`Redis accepts connections on ${rd.hostname}:${rd.port || 6379}`);
  else
    fail('Redis port', `Nothing answers on ${rd.hostname}:${rd.port || 6379}. Run: pnpm infra:up`);

  const ping = docker(['exec', '-T', 'redis', 'redis-cli', '-n', String(E2E_REDIS_DB), 'PING']);
  if (ping.ok && ping.out === 'PONG') ok(`Redis database ${E2E_REDIS_DB} answers PING`);
  else
    fail(
      `Redis database ${E2E_REDIS_DB}`,
      'redis-cli PING failed. Check the redis container: docker compose -f docker/compose.dev.yml logs redis',
    );

  const exists = select('postgres', `SELECT 1 FROM pg_database WHERE datname = '${E2E_DB}'`);
  if (!exists.ok)
    fail(
      'PostgreSQL query',
      'Could not query the database list. Check the postgres container logs.',
    );
  else if (exists.out !== '1') {
    fail(
      `Database ${E2E_DB}`,
      `It does not exist yet. Run: pnpm e2e:db:prepare (creates only ${E2E_DB}).`,
    );
  } else {
    ok(`Database ${E2E_DB} exists`);
    const applied = select(
      E2E_DB,
      'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    );
    const pending = applied.ok ? pendingMigrations(applied.out.split('\n').filter(Boolean)) : null;
    if (!pending)
      fail('E2E migrations', `No migration history in ${E2E_DB}. Run: pnpm e2e:db:prepare`);
    else if (pending.length)
      fail(
        'E2E migrations',
        `${pending.length} not applied to ${E2E_DB} (${pending.join(', ')}). Run: pnpm e2e:db:migrate`,
      );
    else ok(`All migrations applied to ${E2E_DB}`);
    const seeded = select(
      E2E_DB,
      "SELECT count(*) FROM users WHERE email LIKE 'e2e-%@medcore.test'",
    );
    if (seeded.ok && Number(seeded.out) > 0)
      ok(`${E2E_DB} is seeded (${seeded.out} test accounts)`);
    else fail('E2E seed', `No test accounts in ${E2E_DB}. Run: pnpm e2e:db:seed`);
  }

  for (const [port, what] of [
    [E2E_API_PORT, 'API'],
    [E2E_WEB_PORT, 'web'],
  ]) {
    if (await tcp('127.0.0.1', port, 500))
      fail(
        `Port ${port}`,
        `Something is already using port ${port} (E2E ${what}). Stop it first; on macOS, find it with: lsof -nP -iTCP:${port} -sTCP:LISTEN`,
      );
    else ok(`Port ${port} is free for the E2E ${what}`);
  }
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const results = await runChecks();
  for (const r of results)
    process.stdout.write(
      `${r.ok ? '  ok  ' : '  FAIL'}  ${r.name}${r.ok ? '' : `\n        ${r.fix}`}\n`,
    );
  const failed = results.filter((r) => !r.ok).length;
  process.stdout.write(
    failed
      ? `\nE2E preflight: ${failed} problem(s). Nothing was started or changed.\n`
      : '\nE2E preflight passed.\n',
  );
  process.exit(failed ? 1 : 0);
}
