import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Drift guard (DEC-031). Prisma Migrate drops any foreign key or unique constraint that exists in
 * the database but not in schema.prisma. Every such object added by hand-written SQL must therefore
 * also be declared in the schema with the same name (`map: "<name>"`). CHECK constraints, exclusion
 * constraints, triggers and expression/partial indexes are not managed by Prisma and are not listed.
 */
const prismaDir = resolve(__dirname, '../../../prisma');
const schema = readFileSync(resolve(prismaDir, 'schema.prisma'), 'utf8');

function managedObjects(sql: string): string[] {
  const re = /ADD CONSTRAINT (\w+)\s+(?:FOREIGN KEY|UNIQUE)/g;
  return [...sql.matchAll(re)].map((m) => m[1]!);
}

describe('hand-written SQL objects that Prisma manages are declared in schema.prisma', () => {
  const sources = [
    resolve(prismaDir, 'sql/constraints.sql'),
    ...readdirSync(resolve(prismaDir, 'migrations'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => resolve(prismaDir, 'migrations', d.name, 'migration.sql')),
  ];

  it('finds the four same-tenant keys of the initial migration', () => {
    expect(managedObjects(readFileSync(sources[0]!, 'utf8')).sort()).toEqual([
      'hospitals_address_same_tenant_fkey',
      'notification_deliveries_same_tenant_fkey',
      'notifications_id_hospital_key',
      'notifications_recipient_same_tenant_fkey',
    ]);
  });

  it.each(sources.map((s) => [s.replace(prismaDir, 'prisma')]))('%s', (rel) => {
    const sql = readFileSync(resolve(prismaDir, rel.replace(/^prisma\//, '')), 'utf8');
    for (const name of managedObjects(sql)) expect(schema).toContain(`map: "${name}"`);
  });
});
