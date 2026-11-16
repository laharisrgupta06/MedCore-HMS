import { randomBytes } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { TenantContext } from '../src/common/tenancy/tenant-context';
import { TenantPrismaService } from '../src/common/tenancy/tenant-prisma.service';
import type { PrismaService } from '../src/infra/prisma/prisma.service';

/**
 * Phase 1C against real PostgreSQL (T-TEN-INT-001): the Prisma query extension isolates tenants
 * with real queries, and the composite foreign keys reject a cross-tenant relation even when code
 * bypasses the extension. Requires the initial migration (P1A-04).
 */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function migrated(): Promise<void> {
  const rows = await prisma.$queryRaw<
    { t: string | null }[]
  >`SELECT to_regclass('public.users')::text AS t`;
  if (!rows[0]?.t)
    throw new Error('Initial migration not applied (P1A-04): the users table does not exist.');
}

async function hospitalWithNurse(run: string, tag: string) {
  const hospital = await prisma.hospital.create({
    data: {
      name: `Tenancy ${tag} ${run}`,
      code: `TEN${tag}-${run}`.toUpperCase(),
      email: `int-ten-${tag}-${run}@example.com`,
      phone: '+910000000000',
      licenseNumber: `TEN-${tag}-${run}`,
      status: 'VERIFIED',
    },
  });
  // The deferred role/profile trigger requires the staff profile in the same transaction.
  const nurse = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        hospitalId: hospital.id,
        email: `int-ten-nurse-${tag}-${run}@example.com`,
        passwordHash: 'x',
        role: 'NURSE',
        firstName: 'Int',
        lastName: tag,
      },
    });
    await tx.staffProfile.create({ data: { hospitalId: hospital.id, userId: u.id } });
    return u;
  });
  const department = await prisma.department.create({
    data: { hospitalId: hospital.id, name: `int-ten-dept-${tag}-${run}` },
  });
  return { hospital, nurse, department };
}

describe('Phase 1C integration: tenant isolation on PostgreSQL', () => {
  it('the scoped client never reads or writes another hospital; composite FKs back it up', async () => {
    await migrated();
    const run = randomBytes(3).toString('hex');
    const a = await hospitalWithNurse(run, 'a');
    const b = await hospitalWithNurse(run, 'b');
    const db = new TenantPrismaService(prisma as unknown as PrismaService);

    await TenantContext.run(async () => {
      TenantContext.setPrincipal({
        userId: a.nurse.id,
        role: 'NURSE',
        hospitalId: a.hospital.id,
        sessionId: 's',
      });
      expect(await db.client.user.findFirst({ where: { id: b.nurse.id } })).toBeNull();
      expect(await db.client.user.findUnique({ where: { id: b.nurse.id } })).toBeNull();
      const visible = await db.client.user.findMany({
        where: { email: { startsWith: 'int-ten-' } },
      });
      expect(visible.every((u) => u.hospitalId === a.hospital.id)).toBe(true);
      await expect(
        db.client.user.update({ where: { id: b.nurse.id }, data: { firstName: 'Hacked' } }),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError); // P2025: not found
      await expect(
        db.client.department.create({ data: { hospitalId: b.hospital.id, name: 'X' } as never }),
      ).rejects.toMatchObject({ response: { code: 'TENANT_MISMATCH' } });
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: b.nurse.id } })).firstName).toBe(
      'Int',
    );

    // Bypassing the extension: hospital A's staff profile cannot point at hospital B's department.
    // P2003 = foreign key violation, i.e. rejected by the composite (departmentId, hospitalId) key.
    await expect(
      prisma.staffProfile.update({
        where: { userId: a.nurse.id },
        data: { departmentId: b.department.id },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
});
