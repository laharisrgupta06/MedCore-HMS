// Read-only drift check (docs/migration-review.md, step 6). Prints the SQL Prisma would run to make
// the database match schema.prisma. Objects created by prisma/sql/constraints.sql that Prisma does
// not model would appear here as DROP statements. Nothing is executed against the database.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set (expected in the repository-root .env).');
  process.exit(1);
}
const cli = fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url));
const r = spawnSync(
  process.execPath,
  [
    cli,
    'migrate',
    'diff',
    '--from-url',
    url,
    '--to-schema-datamodel',
    'prisma/schema.prisma',
    '--script',
  ],
  { stdio: 'inherit' },
);
process.exit(r.status ?? 1);
