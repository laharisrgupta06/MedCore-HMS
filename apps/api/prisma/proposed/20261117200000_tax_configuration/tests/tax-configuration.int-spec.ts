import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

/**
 * M-11a tax configuration rules on real PostgreSQL (T-MIG-TAX-002..008, DEC-045 to DEC-050).
 * Requires migration 20261117200000_tax_configuration. Creates rows prefixed "int-" in the local
 * database. Tax classifications and GST registrations can never be deleted (by design), so every
 * run uses fresh names and a freshly generated GSTIN.
 */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const run = randomBytes(3).toString('hex');
let n = 0;
const uid = () => `${run}-${++n}`;

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** A well-formed GSTIN for state 27 with a random PAN and the correct mod-36 check character. */
function gstin(): string {
  const letters = () => Array.from(randomBytes(5), (b) => ALPHABET[10 + (b % 26)]).join('');
  const digits = () => Array.from(randomBytes(4), (b) => String(b % 10)).join('');
  const first14 = `27${letters()}${digits()}${ALPHABET[10 + (randomBytes(1)[0]! % 26)]}1Z`;
  let s = 0;
  for (let i = 0; i < 14; i++) {
    const p = ALPHABET.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    s += Math.floor(p / 36) + (p % 36);
  }
  return first14 + ALPHABET[(36 - (s % 36)) % 36];
}

async function requireMigration(): Promise<void> {
  const rows = await prisma.$queryRaw<
    { t: string | null }[]
  >`SELECT to_regclass('public.tax_classifications')::text AS t`;
  if (!rows[0]?.t)
    throw new Error('M-11a not applied: the tax_classifications table does not exist.');
}

/** A verified hospital with a hospital admin (users and staff profiles are created together). */
async function hospitalWithAdmin() {
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
  const admin = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        hospitalId: h.id,
        email: `int-admin-${uid()}@example.com`,
        passwordHash: 'x',
        role: 'HOSPITAL_ADMIN',
        firstName: 'Int',
        lastName: 'Admin',
      },
    });
    await tx.staffProfile.create({ data: { hospitalId: h.id, userId: u.id } });
    return u;
  });
  return { h, admin };
}

/** Today and other days in the hospital's time zone (new hospitals default to Asia/Kolkata). */
async function day(offset: number): Promise<Date> {
  const [r] = await prisma.$queryRaw<{ d: Date }[]>`
    SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date + ${offset}::integer) AS d`;
  return r!.d;
}

async function classification(hospitalId: string, userId: string, supplyType: 'GOODS' | 'SERVICE') {
  return prisma.taxClassification.create({
    data: {
      hospitalId,
      createdById: userId,
      name: `int-${supplyType.toLowerCase()}-${uid()}`,
      supplyType,
      hsnSac: supplyType === 'SERVICE' ? '9993' : '3004',
    },
  });
}

beforeAll(requireMigration);

describe('T-MIG-TAX-002: tax classifications', () => {
  it('keep their code and supply type and are never deleted', async () => {
    const { h, admin } = await hospitalWithAdmin();
    const c = await classification(h.id, admin.id, 'SERVICE');
    await expect(
      prisma.taxClassification.update({
        where: { id: c.id },
        data: { name: `int-renamed-${uid()}` },
      }),
    ).resolves.toBeDefined();
    await expect(
      prisma.taxClassification.update({ where: { id: c.id }, data: { hsnSac: '999311' } }),
    ).rejects.toThrow(/Only the name and active flag/);
    await expect(prisma.taxClassification.delete({ where: { id: c.id } })).rejects.toThrow(
      /never deleted/,
    );
  });

  it('enforce SAC codes for services and HSN codes for goods', async () => {
    const { h, admin } = await hospitalWithAdmin();
    await expect(
      prisma.taxClassification.create({
        data: {
          hospitalId: h.id,
          createdById: admin.id,
          name: `int-${uid()}`,
          supplyType: 'GOODS',
          hsnSac: '9993',
        },
      }),
    ).rejects.toThrow(/tax_classifications_code_chk/);
  });
});

describe('T-MIG-TAX-003: classification versions', () => {
  it('store exact rates and dates, and cannot change once in force', async () => {
    const { h, admin } = await hospitalWithAdmin();
    const c = await classification(h.id, admin.id, 'GOODS');
    const today = await day(0);
    const v = await prisma.taxClassificationVersion.create({
      data: {
        hospitalId: h.id,
        classificationId: c.id,
        createdById: admin.id,
        treatment: 'TAXABLE',
        ratePercent: '5.00',
        priceIncludesTax: true,
        effectiveFrom: today,
      },
    });
    expect(v.ratePercent.toFixed(2)).toBe('5.00');
    expect(v.effectiveFrom.toISOString().slice(0, 10)).toBe(today.toISOString().slice(0, 10));
    await expect(
      prisma.taxClassificationVersion.update({
        where: { id: v.id },
        data: { ratePercent: '12.00' },
      }),
    ).rejects.toThrow(/has taken effect cannot change/);
    await expect(prisma.taxClassificationVersion.delete({ where: { id: v.id } })).rejects.toThrow(
      /has taken effect cannot change/,
    );
  });

  it('can be corrected or withdrawn before they take effect, but never backdated', async () => {
    const { h, admin } = await hospitalWithAdmin();
    const c = await classification(h.id, admin.id, 'GOODS');
    const base = { hospitalId: h.id, classificationId: c.id, createdById: admin.id };
    const future = await prisma.taxClassificationVersion.create({
      data: {
        ...base,
        treatment: 'TAXABLE',
        ratePercent: '12.00',
        priceIncludesTax: true,
        effectiveFrom: await day(30),
      },
    });
    await expect(
      prisma.taxClassificationVersion.update({
        where: { id: future.id },
        data: { ratePercent: '5.00' },
      }),
    ).resolves.toBeDefined();
    await expect(
      prisma.taxClassificationVersion.delete({ where: { id: future.id } }),
    ).resolves.toBeDefined();
    await expect(
      prisma.taxClassificationVersion.create({
        data: {
          ...base,
          treatment: 'NIL_RATED',
          ratePercent: '0',
          priceIncludesTax: false,
          effectiveFrom: await day(-1),
        },
      }),
    ).rejects.toThrow(/cannot start before today/);
    await expect(
      prisma.taxClassificationVersion.create({
        data: {
          ...base,
          treatment: 'EXEMPT',
          ratePercent: '5.00',
          priceIncludesTax: false,
          effectiveFrom: await day(0),
        },
      }),
    ).rejects.toThrow(/tax_classification_versions_rate_chk/);
  });
});

describe('T-MIG-TAX-004: item classifications stay within the hospital and the supply type', () => {
  it('refuses another hospital classification and the wrong supply type', async () => {
    const a = await hospitalWithAdmin();
    const b = await hospitalWithAdmin();
    const serviceA = await classification(a.h.id, a.admin.id, 'SERVICE');
    const serviceB = await classification(b.h.id, b.admin.id, 'SERVICE');
    const medicine = await prisma.medicine.create({
      data: {
        hospitalId: a.h.id,
        name: `int-med-${uid()}`,
        form: 'TABLET',
        strength: '500 mg',
        reorderLevel: 10,
      },
    });
    const labTest = await prisma.labTest.create({
      data: { hospitalId: a.h.id, code: `INT${uid()}`.toUpperCase(), name: 'int test', price: 300 },
    });
    await expect(
      prisma.labTest.update({
        where: { id: labTest.id },
        data: { taxClassificationId: serviceB.id },
      }),
    ).rejects.toMatchObject({ code: 'P2003' }); // composite (taxClassificationId, hospitalId) key
    await expect(
      prisma.medicine.update({
        where: { id: medicine.id },
        data: { taxClassificationId: serviceA.id },
      }),
    ).rejects.toThrow(/needs a goods tax classification/);
    await expect(
      prisma.labTest.update({
        where: { id: labTest.id },
        data: { taxClassificationId: serviceA.id },
      }),
    ).resolves.toMatchObject({ taxClassificationId: serviceA.id });
  });
});

describe('T-MIG-TAX-005: hospital defaults and confirmation', () => {
  it('accept service classifications only, cannot be removed, and keep their classification active', async () => {
    const { h, admin } = await hospitalWithAdmin();
    const service = await classification(h.id, admin.id, 'SERVICE');
    const goods = await classification(h.id, admin.id, 'GOODS');
    await expect(
      prisma.hospitalTaxDefault.create({
        data: { hospitalId: h.id, kind: 'LAB', classificationId: goods.id, updatedById: admin.id },
      }),
    ).rejects.toThrow(/needs a service tax classification/);
    await prisma.hospitalTaxDefault.create({
      data: {
        hospitalId: h.id,
        kind: 'CONSULTATION',
        classificationId: service.id,
        updatedById: admin.id,
      },
    });
    await expect(
      prisma.taxClassification.update({ where: { id: service.id }, data: { isActive: false } }),
    ).rejects.toThrow(/used as a hospital default/);
    await expect(
      prisma.hospitalTaxDefault.delete({
        where: { hospitalId_kind: { hospitalId: h.id, kind: 'CONSULTATION' } },
      }),
    ).rejects.toThrow(/cannot be removed/);
    await expect(
      prisma.hospital.update({
        where: { id: h.id },
        data: { taxSetupConfirmedAt: new Date(), taxSetupConfirmedById: admin.id },
      }),
    ).resolves.toBeDefined();
  });
});

describe('T-MIG-TAX-006: GST registrations', () => {
  it('validate the GSTIN, refuse backdating and edits', async () => {
    const { h, admin } = await hospitalWithAdmin();
    const g = gstin();
    const base = { hospitalId: h.id, attestedById: admin.id, legalName: 'int legal name' };
    const wrongCheck = g.slice(0, 14) + (g[14] === 'A' ? 'B' : 'A');
    await expect(
      prisma.hospitalGstRegistration.create({
        data: {
          ...base,
          registrationType: 'REGULAR',
          gstin: wrongCheck,
          stateCode: '27',
          effectiveFrom: await day(0),
        },
      }),
    ).rejects.toThrow(/hospital_gst_registrations_details_chk/);
    await expect(
      prisma.hospitalGstRegistration.create({
        data: {
          ...base,
          registrationType: 'REGULAR',
          gstin: g,
          stateCode: '27',
          effectiveFrom: await day(-1),
        },
      }),
    ).rejects.toThrow(/cannot be backdated/);
    const r = await prisma.hospitalGstRegistration.create({
      data: {
        ...base,
        registrationType: 'REGULAR',
        gstin: g,
        stateCode: '27',
        effectiveFrom: await day(0),
      },
    });
    await expect(
      prisma.hospitalGstRegistration.update({
        where: { id: r.id },
        data: { legalName: 'changed' },
      }),
    ).rejects.toThrow(/never edited/);
    await expect(prisma.hospitalGstRegistration.delete({ where: { id: r.id } })).rejects.toThrow(
      /cannot be deleted/,
    );
  });

  it('Q1g A: one GSTIN belongs to one hospital, across registration changes', async () => {
    const a = await hospitalWithAdmin();
    const b = await hospitalWithAdmin();
    const g = gstin();
    await prisma.hospitalGstRegistration.create({
      data: {
        hospitalId: a.h.id,
        attestedById: a.admin.id,
        registrationType: 'COMPOSITION',
        gstin: g,
        legalName: 'A',
        stateCode: '27',
        effectiveFrom: await day(0),
      },
    });
    // The same GSTIN moving from composition to regular in the same hospital is allowed.
    await expect(
      prisma.hospitalGstRegistration.create({
        data: {
          hospitalId: a.h.id,
          attestedById: a.admin.id,
          registrationType: 'REGULAR',
          gstin: g,
          legalName: 'A',
          stateCode: '27',
          effectiveFrom: await day(1),
        },
      }),
    ).resolves.toBeDefined();
    await expect(
      prisma.hospitalGstRegistration.create({
        data: {
          hospitalId: b.h.id,
          attestedById: b.admin.id,
          registrationType: 'REGULAR',
          gstin: g,
          legalName: 'B',
          stateCode: '27',
          effectiveFrom: await day(0),
        },
      }),
    ).rejects.toThrow(/hospital_gst_registrations_gstin_one_hospital/);
  });
});

describe('T-MIG-TAX-007: the statutory room rule', () => {
  it('is seeded once and cannot be changed', async () => {
    const rules = await prisma.statutoryRoomTaxRule.findMany();
    const seed = rules.find((r) => r.effectiveFrom.toISOString().startsWith('2022-07-18'));
    expect(seed).toBeDefined();
    expect(seed!.thresholdPerDay.toFixed(2)).toBe('5000.00');
    expect(seed!.ratePercent.toFixed(2)).toBe('5.00');
    expect(seed!.sacCode).toBe('9993');
    expect(seed!.priceIncludesTax).toBe(false);
    await expect(
      prisma.statutoryRoomTaxRule.update({
        where: { id: seed!.id },
        data: { thresholdPerDay: '7500.00' },
      }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.statutoryRoomTaxRule.delete({ where: { id: seed!.id } })).rejects.toThrow(
      /append-only/,
    );
  });
});

describe('T-MIG-TAX-008: critical-care rooms', () => {
  it('store the critical-care unit and leave other room updates unchanged', async () => {
    const { h } = await hospitalWithAdmin();
    const room = await prisma.room.create({
      data: { hospitalId: h.id, number: `int-${uid()}`, type: 'OTHER', dailyCharge: 9000 },
    });
    await expect(
      prisma.room.update({ where: { id: room.id }, data: { criticalCareUnit: 'NICU' } }),
    ).resolves.toMatchObject({ criticalCareUnit: 'NICU' });
    await expect(
      prisma.room.update({ where: { id: room.id }, data: { dailyCharge: 9500 } }),
    ).resolves.toBeDefined();
  });
});
