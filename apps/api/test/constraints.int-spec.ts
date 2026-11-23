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
  it('has 55 tables, 66 triggers, three exclusion constraints and the extensions', async () => {
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
    // 44 tables and 31 triggers through M-06; M-08 and M-10 add one table each, M-09 and M-10 add
    // 11 triggers (counts measured on PostgreSQL 16 after each migration, T-MIG-PH-002). M-11a adds
    // 5 tables, 11 triggers and 1 exclusion constraint (measured on PostgreSQL 16, T-MIG-TAX-001).
    // M-11b adds 4 tables and 11 triggers (measured on PostgreSQL 16, T-MIG-INV-001; named below).
    // M-12 adds 2 triggers; M-13 and M-15 add none (measured on PostgreSQL 16; named below).
    expect(Number(tables!.c)).toBe(55);
    expect(Number(triggers!.c)).toBe(66);
    expect(Number(exclusions!.c)).toBe(3);
    expect(ext.map((e) => e.extname)).toEqual(expect.arrayContaining(['pgcrypto', 'btree_gist']));
    // The Phase 7 objects by name, so a missing one cannot hide behind a correct total.
    const names = await prisma.$queryRaw<{ n: string }[]>`
      SELECT table_name AS n FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('expiry_reports', 'prescription_events')
      UNION ALL
      SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
        'stock_movements_append_only', 'stock_movements_system_quarantine',
        'dispenses_append_only', 'dispenses_rules', 'dispenses_have_status',
        'medicine_batches_status', 'medicine_batches_quarantine_has_ledger',
        'prescriptions_rules', 'prescriptions_have_events',
        'prescription_events_append_only', 'prescription_events_rules')`;
    expect(names.map((x) => x.n).sort()).toEqual(
      [
        'dispenses_append_only',
        'dispenses_have_status',
        'dispenses_rules',
        'expiry_reports',
        'medicine_batches_quarantine_has_ledger',
        'medicine_batches_status',
        'prescription_events',
        'prescription_events_append_only',
        'prescription_events_rules',
        'prescriptions_have_events',
        'prescriptions_rules',
        'stock_movements_append_only',
        'stock_movements_system_quarantine',
      ].sort(),
    );
    // The M-11a tax configuration objects by name (T-MIG-TAX-001).
    const taxNames = await prisma.$queryRaw<{ n: string }[]>`
      SELECT table_name AS n FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('tax_classifications', 'tax_classification_versions',
         'hospital_tax_defaults', 'hospital_gst_registrations', 'statutory_room_tax_rules')
      UNION ALL
      SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
        'tax_classifications_rules', 'tax_classification_versions_rules', 'hospital_gst_registrations_rules',
        'tax_classification_versions_rules_at_commit', 'hospital_gst_registrations_rules_at_commit', 'hospitals_tax_timezone',
        'statutory_room_tax_rules_append_only', 'lab_tests_tax_classification', 'medicines_tax_classification',
        'hospital_tax_defaults_classification', 'hospital_tax_defaults_no_delete')
      UNION ALL
      SELECT conname FROM pg_constraint WHERE contype = 'x' AND conname = 'hospital_gst_registrations_gstin_one_hospital'`;
    expect(taxNames.map((x) => x.n).sort()).toEqual(
      [
        'hospital_gst_registrations',
        'hospital_gst_registrations_gstin_one_hospital',
        'hospital_gst_registrations_rules',
        'hospital_gst_registrations_rules_at_commit',
        'hospital_tax_defaults',
        'hospital_tax_defaults_classification',
        'hospital_tax_defaults_no_delete',
        'hospitals_tax_timezone',
        'lab_tests_tax_classification',
        'medicines_tax_classification',
        'statutory_room_tax_rules',
        'statutory_room_tax_rules_append_only',
        'tax_classification_versions',
        'tax_classification_versions_rules',
        'tax_classification_versions_rules_at_commit',
        'tax_classifications',
        'tax_classifications_rules',
      ].sort(),
    );
    // The M-11b invoice integrity objects by name (T-MIG-INV-001).
    const invoiceNames = await prisma.$queryRaw<{ n: string }[]>`
      SELECT table_name AS n FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('document_number_series', 'invoice_events',
         'invoice_correction_requests', 'invoice_correction_request_notes')
      UNION ALL
      SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
        'document_number_series_rules', 'invoice_items_rules', 'invoices_rules', 'invoices_totals_at_commit',
        'invoice_items_totals_at_commit', 'invoice_events_append_only', 'invoices_history',
        'invoice_correction_requests_rules', 'invoice_correction_request_notes_rules',
        'invoice_correction_requests_append_only', 'invoice_correction_request_notes_append_only')
      UNION ALL
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
        'invoices_one_draft_per_appointment', 'invoices_one_original_per_appointment',
        'invoice_items_lab_unreleased', 'invoice_items_dispense_unreleased',
        'invoice_items_consultation_unreleased', 'document_number_series_one_open',
        'document_number_series_hospitalId_financialYear_prefix_key',
        'document_number_series_numberingScope_financialYear_prefix_key',
        'invoices_numberingScope_financialYear_invoiceNumber_key',
        'invoices_hospitalId_financialYear_invoiceNumber_key', 'invoices_seriesId_serial_key')`;
    expect(invoiceNames.map((x) => x.n).sort()).toEqual(
      [
        'document_number_series',
        'document_number_series_hospitalId_financialYear_prefix_key',
        'document_number_series_numberingScope_financialYear_prefix_key',
        'document_number_series_one_open',
        'document_number_series_rules',
        'invoice_correction_request_notes',
        'invoice_correction_request_notes_append_only',
        'invoice_correction_request_notes_rules',
        'invoice_correction_requests',
        'invoice_correction_requests_append_only',
        'invoice_correction_requests_rules',
        'invoice_events',
        'invoice_events_append_only',
        'invoice_items_consultation_unreleased',
        'invoice_items_dispense_unreleased',
        'invoice_items_lab_unreleased',
        'invoice_items_rules',
        'invoice_items_totals_at_commit',
        'invoices_history',
        'invoices_hospitalId_financialYear_invoiceNumber_key',
        'invoices_numberingScope_financialYear_invoiceNumber_key',
        'invoices_one_draft_per_appointment',
        'invoices_one_original_per_appointment',
        'invoices_rules',
        'invoices_seriesId_serial_key',
        'invoices_totals_at_commit',
      ].sort(),
    );
    // M-12 payment rules, M-13 TPA settlement and M-15 notification key by name. The API opens
    // payments only when payments_invoice_status exists and TPA posting only when the enum value does.
    const paymentNames = await prisma.$queryRaw<{ n: string }[]>`
      SELECT tgname AS n FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
        'payments_invoice_status', 'payments_invoice_consistency')
      UNION ALL
      SELECT conname FROM pg_constraint WHERE conname IN (
        'payments_reversal_complete', 'payments_reversedById_hospitalId_fkey', 'payments_provider_chk')
      UNION ALL
      SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE (t.typname, e.enumlabel) IN (('PaymentStatus', 'REVERSED'), ('PaymentMethod', 'TPA_SETTLEMENT'))
      UNION ALL
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
        'notifications_recipientId_dedupeKey_key', 'notification_deliveries_status_updatedAt_idx')`;
    expect(paymentNames.map((x) => x.n).sort()).toEqual(
      [
        'REVERSED',
        'TPA_SETTLEMENT',
        'notification_deliveries_status_updatedAt_idx',
        'notifications_recipientId_dedupeKey_key',
        'payments_invoice_consistency',
        'payments_invoice_status',
        'payments_provider_chk',
        'payments_reversal_complete',
        'payments_reversedById_hospitalId_fkey',
      ].sort(),
    );
  });
});

describe('T-MIG-008: hospital ids are generated by PostgreSQL (DEC-032)', () => {
  it('creates a hospital without an explicit id', async () => {
    const id = uid();
    const h = await prisma.hospital.create({
      data: {
        name: `int-${id}`,
        code: `INT${id}`.toUpperCase(),
        email: `int-h-${id}@example.com`,
        phone: '+910000000000',
        licenseNumber: `int-${id}`,
      },
    });
    expect(h.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const [col] = await prisma.$queryRaw<{ d: string | null }[]>`
      SELECT column_default AS d FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'hospitals' AND column_name = 'id'`;
    expect(col?.d).toBe('gen_random_uuid()');
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
    ).rejects.toMatchObject({ code: 'P2003' }); // composite (doctorId, hospitalId) foreign key
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

describe('T-MIG-006: invoice drafts under M-11b (TEST-015, DEC-051, DEC-053)', () => {
  // Replaces the initial-schema check of total = subtotal + tax - discount: under M-11b an invoice
  // starts as an empty draft, its totals must equal the sum of its lines at commit (total = subtotal
  // + tax), only a draft can be voided, and invoices are never deleted. Issuing, numbering and lines
  // are covered through the API in test/invoices.int-spec.ts. Rows created here cannot be deleted
  // (by design); they stay in this test's own hospital.
  it('starts empty, keeps totals equal to the lines, voids only drafts and never deletes', async () => {
    const { h, dept } = await hospital();
    const doc = await doctor(h.id);
    const pat = await patient(h.id);
    // Staff users need their staff profile in the same transaction (role/profile rule, constraints.sql).
    const rc = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: userData('RECEPTIONIST', h.id) });
      await tx.staffProfile.create({ data: { hospitalId: h.id, userId: u.id } });
      return u;
    });
    const appt = await prisma.appointment.create({
      data: {
        hospitalId: h.id,
        doctorId: doc.d.id,
        patientId: pat.p.id,
        departmentId: dept.id,
        scheduledAt: at(18),
        endAt: at(18, 30),
        createdById: doc.u.id,
      },
    });
    const base = {
      hospitalId: h.id,
      appointmentId: appt.id,
      patientId: pat.p.id,
      createdById: rc.id,
    };
    await expect(
      prisma.invoice.create({ data: { ...base, subtotal: 100, total: 100 } }),
    ).rejects.toThrow(/starts as an empty draft/);
    const draft = await prisma.invoice.create({ data: base });
    expect(draft).toMatchObject({
      status: 'DRAFT',
      sequence: 1,
      invoiceNumber: null,
      kind: 'ORIGINAL',
    });
    // total = subtotal + tax (DEC-051); the old "minus discount" form is refused by the CHECK.
    await expect(
      prisma.invoice.update({
        where: { id: draft.id },
        data: { subtotal: 100, taxAmount: 18, total: 108 - 10 },
      }),
    ).rejects.toThrow(/invoices_total_chk/);
    // Totals that the lines do not add up to are refused when the transaction commits.
    await expect(
      prisma.invoice.update({ where: { id: draft.id }, data: { subtotal: 100, total: 100 } }),
    ).rejects.toThrow(/Invoice totals must equal the sum of its lines/);
    // A doctor cannot void; a receptionist can, with a reason; then the invoice is final.
    await expect(
      prisma.invoice.update({
        where: { id: draft.id },
        data: { status: 'VOID', voidedById: doc.u.id, voidReason: 'Opened by mistake' },
      }),
    ).rejects.toThrow(/receptionist or accountant can void/);
    await prisma.invoice.update({
      where: { id: draft.id },
      data: { status: 'VOID', voidedById: rc.id, voidReason: 'Opened by mistake' },
    });
    await expect(
      prisma.invoice.update({ where: { id: draft.id }, data: { status: 'DRAFT' } }),
    ).rejects.toThrow(/void invoice cannot change/);
    await expect(prisma.invoice.delete({ where: { id: draft.id } })).rejects.toThrow(
      /never deleted/,
    );
    // A replacement original for the visit is allowed after the void (decision 2).
    await expect(prisma.invoice.create({ data: base })).resolves.toMatchObject({ sequence: 2 });
  });
});
