// Safety tests for the E2E environment (DEC-061). Run: pnpm test:scripts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { E2E_DB, assertE2eDatabaseUrl, databaseName, e2eEnv } from './env.mjs';

const dev = {
  POSTGRES_DB: 'medcore',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/medcore?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  NODE_ENV: 'development',
};

test('derives the E2E database, Redis index, ports and folders', () => {
  const e = e2eEnv(dev);
  assert.equal(databaseName(e.DATABASE_URL), E2E_DB);
  assert.match(e.DATABASE_URL, /localhost:5432\/medcore_e2e\?schema=public$/);
  assert.equal(new URL(e.REDIS_URL).pathname, '/1');
  assert.equal(e.API_PORT, '3101');
  assert.equal(e.WEB_APP_URL, 'http://localhost:3100');
  assert.equal(e.FILE_STORAGE_DIR, 'var/storage-e2e');
  assert.equal(e.NEXT_DIST_DIR, '.next-e2e');
  assert.equal(e.MEDCORE_E2E, '1');
  // Only the disposable E2E stack raises the per-IP auth limit (many test users, one address).
  assert.equal(e.AUTH_THROTTLE_LIMIT, '2000');
  assert.equal(e.SMS_PROVIDER, 'dev-inbox');
});

test('never returns the development database', () => {
  const e = e2eEnv(dev);
  assert.notEqual(databaseName(e.DATABASE_URL), databaseName(dev.DATABASE_URL));
});

test('refuses when the development database already uses the E2E name', () => {
  assert.throws(() => e2eEnv({ ...dev, POSTGRES_DB: E2E_DB }), /reserved/);
  assert.throws(
    () => e2eEnv({ ...dev, DATABASE_URL: 'postgresql://u:p@localhost:5432/medcore_e2e' }),
    /reserved/,
  );
});

test('refuses production settings and a clashing Redis index', () => {
  assert.throws(() => e2eEnv({ ...dev, NODE_ENV: 'production' }), /production/);
  assert.throws(() => e2eEnv({ ...dev, REDIS_URL: 'redis://localhost:6379/1' }), /reserved/);
});

test('refuses when a required setting is missing', () => {
  assert.throws(() => e2eEnv({ ...dev, DATABASE_URL: '' }), /DATABASE_URL/);
});

test('the database guard accepts only medcore_e2e', () => {
  assert.doesNotThrow(() => assertE2eDatabaseUrl('postgresql://u:p@h:5432/medcore_e2e'));
  for (const name of ['medcore', 'medcore_e2e_old', 'postgres', 'MEDCORE_E2E']) {
    assert.throws(() => assertE2eDatabaseUrl(`postgresql://u:p@h:5432/${name}`), /Refusing/);
  }
});

test('error messages never contain the database password', () => {
  try {
    e2eEnv({
      ...dev,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:s3cret@h:5432/medcore',
    });
  } catch (e) {
    assert.doesNotMatch(String(e.message), /s3cret/);
  }
});

// ---- Preflight (check.mjs) ------------------------------------------------------------------
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { E2E_PASSWORD_EMAIL, passwordProblem, pendingMigrations } from './check.mjs';

test('E2E_PASSWORD rules match the application password rules exactly', () => {
  const { checkPassword } = createRequire(import.meta.url)('../../packages/types/dist/index.js');
  const samples = [
    '',
    'short1',
    'abcdefghij',
    '1234567890',
    'abcdefghi1',
    'Correct-Horse-9',
    'x'.repeat(127) + '1',
    'x'.repeat(128) + '1',
    E2E_PASSWORD_EMAIL,
    ' E2E-Super-Admin@medcore.test ',
    'naïve-pass-1',
  ];
  for (const p of samples) {
    assert.equal(
      passwordProblem(p) === null,
      checkPassword(p, E2E_PASSWORD_EMAIL) === null,
      `sample of length ${p.length}`,
    );
  }
  assert.match(passwordProblem(undefined), /not set/);
});

test('pending migrations are those in the repository that are not applied', () => {
  const all = pendingMigrations([]);
  assert.ok(all.length >= 9 && all.includes('20261116085814_init'));
  assert.deepEqual(pendingMigrations(all), []);
  assert.deepEqual(pendingMigrations(all.slice(0, -1)), all.slice(-1));
});

test('the preflight only ever reads, and only the maintenance or E2E database', () => {
  const src = readFileSync(new URL('./check.mjs', import.meta.url), 'utf8');
  const sql = [...src.matchAll(/select\(\s*(?:'postgres'|E2E_DB),\s*[`'"](.+?)[`'"]\s*\)/gs)].map(
    (m) => m[1],
  );
  assert.ok(sql.length >= 3);
  for (const q of sql) assert.match(q.trim(), /^SELECT /);
  assert.doesNotMatch(src, /\b(DROP|CREATE|DELETE|UPDATE|INSERT|TRUNCATE|ALTER)\b/);
});

test('prepare validates E2E_PASSWORD before anything is dropped', () => {
  const src = readFileSync(new URL('./db.mjs', import.meta.url), 'utf8');
  const prepare = src.slice(src.indexOf("if (step === 'prepare')"));
  assert.ok(prepare.indexOf('precheck()') < prepare.indexOf('recreate()'));
});

test('the launcher stops its whole process group, leaving nothing running', async () => {
  // A stand-in for "pnpm exec nest start": a shell whose grandchild ignores nothing and sleeps.
  const script = `
    import { spawn } from 'node:child_process';
    const c = spawn('sh', ['-c', 'sleep 60 & echo $! ; wait'], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] });
    process.on('SIGTERM', () => { try { process.kill(-c.pid, 'SIGTERM'); } catch {} });
    c.on('exit', () => process.exit(0));
  `;
  const launcher = spawn(process.execPath, ['--input-type=module', '-e', script], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const grandchild = await new Promise((done) =>
    launcher.stdout.once('data', (d) => done(Number(String(d).trim()))),
  );
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  assert.ok(alive(grandchild));
  launcher.kill('SIGTERM');
  await new Promise((done) => launcher.once('exit', done));
  await new Promise((done) => setTimeout(done, 300));
  assert.equal(alive(grandchild), false);
});
