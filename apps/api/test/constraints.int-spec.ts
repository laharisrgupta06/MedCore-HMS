import { randomBytes } from 'node:crypto';
import { Prisma, PrismaClient, type Role } from '@prisma/client';

/**
 * Executes the database guarantees of constraints.sql on real PostgreSQL (T-MIG-001..006).
 * Requires the initial migration (P1A-04). Creates rows prefixed "int-" in the local database.
 */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const run = randomBytes(3).toString('hex');
let n = 0;
const uid = () => `${run}-${++n}`;

async function requireMigration(): Promise<void> {
  const rows = await prisma.$queryRaw<
    { t: string | null }[]
  >`SELECT to_regclass('public.users')::text AS t`;
  if (!rows[0]?.t)
    throw new Error('Initial migration not applied (P1A-04): the users table does not exist.');
}

async function hospital() {
  const id = uid();
  const h = await prisma.hospital.create({
    data: {
      name: `int-${id}`,
      code: `INT${id}`.toUpperCase(),
      email: `int-h-${id}@example.com`,
      phone: '+910000000000',
      licenseNumber: `int-${id}`,
      status: 'VERIFIED',
    },
  });
  const dept = await prisma.department.create({
    data: { hospitalId: h.id, name: `int-dept-${id}` },
  });
  return { h, dept };
}

const userData = (role: Role, hospitalId: string | null) => ({
  hospitalId,
  email: `int-${role.toLowerCase()}-${uid()}@example.com`,
  passwordHash: 'x',
  role,
  firstName: 'Int',
  lastName: role,
});

async function doctor(hospitalId: string) {
  return prisma.$transaction(async (tx) => {
    const u = await tx.user.create({ data: userData('DOCTOR', hospitalId) });
    const d = await tx.doctor.create({
      data: {
        hospitalId,
        userId: u.id,
        registrationNumber: uid(),
        specialisation: 'General',
        consultationFee: 500,
      },
    });
    return { u, d };
  });
}

async function patient(hospitalId: string) {
  return prisma.$transaction(async (tx) => {
    const u = await tx.user.create({ data: userData('PATIENT', hospitalId) });
    const p = await tx.patient.create({
      data: {
        hospitalId,
        userId: u.id,
        mrn: `MRN-${uid()}`,
        dateOfBirth: new Date('1990-01-01'),
        gender: 'OTHER',
      },
    });
    return { u, p };
  });
}

const at = (h: number, m = 0) => new Date(Date.UTC(2031, 0, 15, h, m));

beforeAll(requireMigration);

describe('T-MIG-001: database objects exist', () => {
  it('has 44 tables, the triggers, both exclusion constraints and the extensions', async () => {
    const [tables] = await prisma.$queryRaw<{ c: bigint }[]>`
      SELECT count(*) AS c FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'`;
    const [triggers] = await prisma.$queryRaw<
      { c: bigint }[]
    >`SELECT count(*) AS c FROM pg_trigger WHERE NOT tgisinternal`;
    const [exclusions] = await prisma.$queryRaw<
      { c: bigint }[]
    >`SELECT count(*) AS c FROM pg_constraint WHERE contype = 'x'`;
    const ext = await prisma.$queryRaw<{ extname: string }[]>`SELECT extname FROM pg_extension`;
    expect(Number(tables!.c)).toBe(44);
    expect(Number(triggers!.c)).toBe(31);
    expect(Number(exclusions!.c)).toBe(2);
    expect(ext.map((e) => e.extname)).toEqual(expect.arrayContaining(['pgcrypto', 'btree_gist']));
  });
});

describe('T-MIG-002: no double booking', () => {
  it('rejects overlapping doctor and patient appointments, allows emergencies and freed slots', async () => {
    const { h, dept } = await hospital();
    const doc = await doctor(h.id);
    const p1 = await patient(h.id);
    const p2 = await patient(h.id);
    const appt = (
      patientId: string,
      from: Date,
      to: Date,
      extra: Partial<Prisma.AppointmentUncheckedCreateInput> = {},
    ) =>
      prisma.appointment.create({
        data: {
          hospitalId: h.id,
          doctorId: doc.d.id,
          patientId,
          departmentId: dept.id,
          scheduledAt: from,
          endAt: to,
          createdById: doc.u.id,
          ...extra,
        },
      });

    const first = await appt(p1.p.id, at(9), at(9, 30));
    await expect(appt(p2.p.id, at(9, 15), at(9, 45))).rejects.toThrow(); // doctor overlap
    await expect(appt(p1.p.id, at(9, 30), at(10))).resolves.toBeDefined(); // [) ranges: back to back is fine
    await expect(appt(p2.p.id, at(9, 15), at(9, 45), { type: 'EMERGENCY' })).resolves.toBeDefined();
    await expect(appt(p1.p.id, at(9, 10), at(9, 20), { type: 'EMERGENCY' })).rejects.toThrow(); // patient overlap
    await expect(appt(p1.p.id, at(9), at(9, 15))).rejects.toThrow();
    await prisma.appointment.update({
      where: { id: first.id },
      data: { status: 'CANCELLED', cancellationReason: 'int' },
    });
    const p3 = await patient(h.id);
    await expect(appt(p3.p.id, at(9), at(9, 30))).resolves.toBeDefined(); // cancelled slot is free again
    await expect(appt(p3.p.id, at(11), at(10))).rejects.toThrow(); // end before start
  });
});

describe('T-MIG-003: role and profile consistency (all nine roles)', () => {
  it('commits only valid user/profile combinations', async () => {
    const { h } = await hospital();
    await expect(doctor(h.id)).resolves.toBeDefined();
    await expect(patient(h.id)).resolves.toBeDefined();
    for (const role of [
      'HOSPITAL_ADMIN',
      'NURSE',
      'RECEPTIONIST',
      'LAB_TECHNICIAN',
      'PHARMACIST',
      'ACCOUNTANT',
    ] as const) {
      await expect(
        prisma.$transaction(async (tx) => {
          const u = await tx.user.create({ data: userData(role, h.id) });
          await tx.staffProfile.create({ data: { hospitalId: h.id, userId: u.id } });
        }),
      ).resolves.toBeUndefined();
      // Without its profile the transaction fails at COMMIT.
      await expect(prisma.user.create({ data: userData(role, h.id) })).rejects.toThrow();
    }
    await expect(
      prisma.user.create({ data: userData('SUPER_ADMIN', null) }),
    ).resolves.toBeDefined();
    await expect(prisma.user.create({ data: userData('SUPER_ADMIN', h.id) })).rejects.toThrow(); // CHECK
    await expect(prisma.user.create({ data: userData('NURSE', null) })).rejects.toThrow(); // CHECK
    await expect(
      prisma.$transaction(async (tx) => {
        const u = await tx.user.create({ data: userData('NURSE', h.id) });
        await tx.staffProfile.create({
          data: { hospitalId: h.id, userId: u.id, isSeniorLabTechnician: true },
        });
      }),
    ).rejects.toThrow(); // only lab technicians can be senior
    await expect(
      prisma.$transaction(async (tx) => {
        const u = await tx.user.create({ data: userData('DOCTOR', h.id) });
        await tx.staffProfile.create({ data: { hospitalId: h.id, userId: u.id } });
      }),
    ).rejects.toThrow(); // a doctor needs a doctor profile, not a staff profile
  });
});

describe('T-MIG-004: cross-hospital references are impossible', () => {
  it('rejects an appointment whose doctor belongs to another hospital', async () => {
    const a = await hospital();
    const b = await hospital();
    const docB = await doctor(b.h.id);
    const patA = await patient(a.h.id);
    await expect(
      prisma.appointment.create({
        data: {
          hospitalId: a.h.id,
          doctorId: docB.d.id,
          patientId: patA.p.id,
          departmentId: a.dept.id,
          scheduledAt: at(14),
          endAt: at(14, 30),
          createdById: patA.u.id,
        },
      }),
    ).rejects.toThrow();
  });
});

describe('T-MIG-005: clinical and audit immutability', () => {
  it('audit log rows can never be changed or deleted', async () => {
    const row = await prisma.auditLog.create({ data: { action: 'int.test', entityType: 'Test' } });
    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { action: 'tampered' } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });

  it('medical records are never deleted and are locked once closed', async () => {
    const { h, dept } = await hospital();
    const doc = await doctor(h.id);
    const pat = await patient(h.id);
    const appt = await prisma.appointment.create({
      data: {
        hospitalId: h.id,
        doctorId: doc.d.id,
        patientId: pat.p.id,
        departmentId: dept.id,
        scheduledAt: at(16),
        endAt: at(16, 30),
        createdById: doc.u.id,
      },
    });
    const rec = await prisma.medicalRecord.create({
      data: { hospitalId: h.id, appointmentId: appt.id, chiefComplaint: 'int' },
    });
    await expect(prisma.medicalRecord.delete({ where: { id: rec.id } })).rejects.toThrow(
      /append-only/,
    );
    await prisma.medicalRecord.update({
      where: { id: rec.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    await expect(
      prisma.medicalRecord.update({ where: { id: rec.id }, data: { chiefComplaint: 'changed' } }),
    ).rejects.toThrow(/closed/);
  });
});

describe('T-MIG-006: invoice totals (TEST-015)', () => {
  it('rejects a total that is not subtotal + tax − discount', async () => {
    const { h, dept } = await hospital();
    const doc = await doctor(h.id);
    const pat = await patient(h.id);
    const appt = (hour: number) =>
      prisma.appointment.create({
        data: {
          hospitalId: h.id,
          doctorId: doc.d.id,
          patientId: pat.p.id,
          departmentId: dept.id,
          scheduledAt: at(hour),
          endAt: at(hour, 30),
          createdById: doc.u.id,
        },
      });
    const ok = await appt(18);
    const bad = await appt(19);
    const inv = (appointmentId: string, total: number) =>
      prisma.invoice.create({
        data: {
          hospitalId: h.id,
          appointmentId,
          invoiceNumber: `INV-${uid()}`,
          subtotal: 100,
          taxAmount: 18,
          discountAmount: 10,
          total,
        },
      });
    await expect(inv(ok.id, 108)).resolves.toBeDefined();
    await expect(inv(bad.id, 118)).rejects.toThrow();
  });
});
