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
