import { FakePrisma } from '../../testing/fake-prisma';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { TenantContext } from './tenant-context';
import { TenantPrismaService } from './tenant-prisma.service';

describe('TenantPrismaService (TEN-003/004)', () => {
  const fake = new FakePrisma();
  const a = fake.addHospital({ code: 'HOSPA' });
  const b = fake.addHospital({ code: 'HOSPB' });
  const userA = fake.addUser({ role: 'NURSE', hospitalId: a.id });
  const userB = fake.addUser({ role: 'NURSE', hospitalId: b.id });
  const root = fake.addUser({ role: 'SUPER_ADMIN' });
  const service = new TenantPrismaService(fake as unknown as PrismaService);
  const as = <T>(
    p: { userId: string; role: 'NURSE' | 'SUPER_ADMIN'; hospitalId: string | null },
    fn: () => Promise<T>,
  ) =>
    TenantContext.run(async () => {
      TenantContext.setPrincipal({ ...p, sessionId: 's' });
      return { result: await fn(), store: TenantContext.store() };
    });

  it('restricts a hospital user to their hospital', async () => {
    const { result } = await as({ userId: userA.id, role: 'NURSE', hospitalId: a.id }, () =>
      service.client.user.findMany({}),
    );
    expect(result.map((u) => u.id)).toEqual([userA.id]);
    const other = await as({ userId: userA.id, role: 'NURSE', hospitalId: a.id }, () =>
      service.client.user.findFirst({ where: { id: userB.id } }),
    );
    expect(other.result).toBeNull();
  });

  it('gives a Super Admin all tenants and flags the request as cross-tenant', async () => {
    const { result, store } = await as(
      { userId: root.id, role: 'SUPER_ADMIN', hospitalId: null },
      () => service.client.user.findMany({}),
    );
    expect(result).toHaveLength(3);
    expect(store?.crossTenantAccess).toBe(true);
  });

  it('refuses to work outside an authenticated request', () => {
    expect(() => service.client).toThrow(/outside an authenticated request/);
    expect(() => TenantContext.run(() => service.client)).toThrow(
      /outside an authenticated request/,
    );
  });
});
