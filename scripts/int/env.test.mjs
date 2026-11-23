import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INT_DB, intEnv } from './db.mjs';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/medcore?schema=public',
  POSTGRES_DB: 'medcore',
};

test('switches only the database name to medcore_int', () => {
  const env = intEnv(base);
  const u = new URL(env.DATABASE_URL);
  assert.equal(u.pathname, `/${INT_DB}`);
  assert.equal(u.host, 'localhost:5432');
  assert.equal(u.searchParams.get('schema'), 'public');
});

test('refuses a development database already named medcore_int', () => {
  assert.throws(() => intEnv({ ...base, POSTGRES_DB: INT_DB }), /reserved/);
  assert.throws(
    () => intEnv({ ...base, DATABASE_URL: 'postgresql://u:p@h/medcore_int' }),
    /reserved/,
  );
});

test('refuses production settings and missing settings', () => {
  assert.throws(() => intEnv({ ...base, NODE_ENV: 'production' }), /production/);
  assert.throws(() => intEnv({ POSTGRES_DB: 'medcore' }), /DATABASE_URL/);
});
