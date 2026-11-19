import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

/**
 * M-11a tax configuration rules on real PostgreSQL (T-MIG-TAX-002..013, DEC-045 to DEC-050).
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
/** PAN holder types accepted by medcore_gstin_valid (DEC-048 revision 2); K is refused. */
const PAN_HOLDER_TYPES = 'ABCFGHJLPT';

/** Appends the mod-36 check character to the first 14 characters of a GSTIN. */
function withCheckCharacter(first14: string): string {
  let s = 0;
  for (let i = 0; i < 14; i++) {
    const p = ALPHABET.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    s += Math.floor(p / 36) + (p % 36);
  }
  return first14 + ALPHABET[(36 - (s % 36)) % 36];
}

/**
 * A GSTIN that medcore_gstin_valid accepts (DEC-048 revision 2): state 27, a random PAN whose fourth
 * character is a valid holder type and whose serial is 0001..9999, entity 1, Z, check character.
 * Random so every run uses a GSTIN no earlier run has registered (the exclusion constraint keeps a
 * GSTIN to one hospital, and integration runs keep their rows).
 */
function gstin(): string {
  const r = randomBytes(8);
  const letter = (b: number) => ALPHABET[10 + (b % 26)]!;
  const serial = String(1 + (r.readUInt16BE(6) % 9999)).padStart(4, '0');
  const holder = PAN_HOLDER_TYPES[r[3]! % PAN_HOLDER_TYPES.length]!;
  const pan = `${letter(r[0]!)}${letter(r[1]!)}${letter(r[2]!)}${holder}${letter(r[4]!)}${serial}${letter(r[5]!)}`;
  return withCheckCharacter(`27${pan}1Z`);
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

/**
 * The hospital's tax date (its local date ten minutes from now, as medcore_tax_date computes it) plus
 * an offset. New hospitals default to Asia/Kolkata.
 */
async function day(offset: number): Promise<Date> {
  const [r] = await prisma.$queryRaw<{ d: Date }[]>`
    SELECT (((clock_timestamp() + interval '10 minutes') AT TIME ZONE 'Asia/Kolkata')::date + ${offset}::integer) AS d`;
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
    ).rejects.toThrow(/cannot change \(tax date/);
    await expect(prisma.taxClassificationVersion.delete({ where: { id: v.id } })).rejects.toThrow(
      /cannot change \(tax date/,
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
    ).rejects.toThrow(/cannot start before/);
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

  it('test GSTINs are valid, and the holder-type and serial rules are enforced (regression)', async () => {
    // Regression: the generator once drew the PAN holder type from all 26 letters, so about 61% of
    // generated GSTINs failed hospital_gst_registrations_details_chk and these tests failed at random.
    const sample = Array.from({ length: 200 }, gstin);
    const [row] = await prisma.$queryRaw<{ invalid: bigint }[]>`
      SELECT count(*) AS invalid FROM unnest(${sample}::text[]) AS g WHERE NOT medcore_gstin_valid(g)`;
    expect(Number(row!.invalid)).toBe(0);

    const { h, admin } = await hospitalWithAdmin();
    const g = gstin();
    const base = {
      hospitalId: h.id,
      attestedById: admin.id,
      legalName: 'int legal name',
      stateCode: '27',
      effectiveFrom: await day(0),
    };
    // Same PAN with holder type K (not a current PAN category), with a correct check character.
    const holderK = withCheckCharacter(`${g.slice(0, 5)}K${g.slice(6, 14)}`);
    // Same PAN with serial 0000, with a correct check character.
    const serial0000 = withCheckCharacter(`${g.slice(0, 7)}0000${g.slice(11, 14)}`);
    for (const bad of [holderK, serial0000]) {
      for (const registrationType of ['REGULAR', 'COMPOSITION'] as const) {
        await expect(
          prisma.hospitalGstRegistration.create({
            data: { ...base, registrationType, gstin: bad },
          }),
        ).rejects.toThrow(/hospital_gst_registrations_details_chk/);
      }
    }
    // A composition registration with a valid GSTIN is accepted.
    await expect(
      prisma.hospitalGstRegistration.create({
        data: { ...base, registrationType: 'COMPOSITION', gstin: g },
      }),
    ).resolves.toMatchObject({ registrationType: 'COMPOSITION', gstin: g });
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

describe('T-MIG-TAX-009: the time zone is fixed once tax dates exist (revision 2)', () => {
  it('can change before, is stamped by the first version, and is then refused', async () => {
    const { h, admin } = await hospitalWithAdmin();
    await expect(
      prisma.hospital.update({ where: { id: h.id }, data: { timezone: 'Asia/Dubai' } }),
    ).resolves.toMatchObject({ timezone: 'Asia/Dubai', taxTimezoneLockedAt: null });
    await prisma.hospital.update({ where: { id: h.id }, data: { timezone: 'Asia/Kolkata' } });
    const c = await classification(h.id, admin.id, 'GOODS');
    await prisma.taxClassificationVersion.create({
      data: {
        hospitalId: h.id,
        classificationId: c.id,
        createdById: admin.id,
        treatment: 'TAXABLE',
        ratePercent: '5.00',
        priceIncludesTax: true,
        effectiveFrom: await day(0),
      },
    });
    const locked = await prisma.hospital.findUniqueOrThrow({ where: { id: h.id } });
    expect(locked.taxTimezoneLockedAt).toBeInstanceOf(Date);
    await expect(
      prisma.hospital.update({ where: { id: h.id }, data: { timezone: 'America/Los_Angeles' } }),
    ).rejects.toThrow(
      /time zone of a hospital with tax versions or GST registrations cannot change/,
    );
    await expect(
      prisma.hospital.update({ where: { id: h.id }, data: { taxTimezoneLockedAt: null } }),
    ).rejects.toThrow(/cannot change/);
    await expect(
      prisma.hospital.update({ where: { id: h.id }, data: { phone: '+910000000001' } }),
    ).resolves.toBeDefined();
  });
});

describe('T-MIG-TAX-010: effective dates are checked again at commit (revision 2)', () => {
  it('refuses an edit made before midnight whose commit lands after it', async () => {
    const { h, admin } = await hospitalWithAdmin();
    const c = await classification(h.id, admin.id, 'GOODS');
    const v = await prisma.taxClassificationVersion.create({
      data: {
        hospitalId: h.id,
        classificationId: c.id,
        createdById: admin.id,
        treatment: 'TAXABLE',
        ratePercent: '12.00',
        priceIncludesTax: true,
        effectiveFrom: await day(2),
      },
    });
    const start = v.effectiveFrom.toISOString().slice(0, 10);
    // Inside one transaction that always rolls back: swap the tax clock for a simulated one, edit the
    // version at 23:45 the evening before it starts (accepted), move the clock past midnight and run
    // the commit-time checks. The swap is undone with the transaction.
    const run = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        "CREATE OR REPLACE FUNCTION medcore_tax_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$ SELECT current_setting('medcore_test.clock')::timestamptz $$",
      );
      await tx.$executeRawUnsafe(
        `SELECT set_config('medcore_test.clock', (DATE '${start}' - 1 + TIME '23:45')::text || '+05:30', true)`,
      );
      await tx.taxClassificationVersion.update({
        where: { id: v.id },
        data: { ratePercent: '5.00' },
      });
      await tx.$executeRawUnsafe(
        `SELECT set_config('medcore_test.clock', (DATE '${start}' + TIME '00:01')::text || '+05:30', true)`,
      );
      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
      throw new Error('commit-time check did not fire');
    });
    await expect(run).rejects.toThrow(/cannot change \(tax date/);
    const after = await prisma.taxClassificationVersion.findUniqueOrThrow({ where: { id: v.id } });
    expect(after.ratePercent.toFixed(2)).toBe('12.00');
    const [clockFn] = await prisma.$queryRaw<{ src: string }[]>`
      SELECT prosrc AS src FROM pg_proc WHERE proname = 'medcore_tax_clock'`;
    expect(clockFn!.src).toContain('clock_timestamp()');
  });
});

describe('T-MIG-TAX-011: writers hold row locks until they commit (revision 3)', () => {
  // A second connection plays the reader. NOWAIT makes the checks independent of timing: a locked row
  // fails at once with "could not obtain lock" instead of waiting.
  const reader = new PrismaClient();
  afterAll(() => reader.$disconnect());

  it('a version writer locks its hospital and classification rows: locking readers wait, plain reads see the old value', async () => {
    const { h, admin } = await hospitalWithAdmin();
    const c = await classification(h.id, admin.id, 'GOODS');
    const v = await prisma.taxClassificationVersion.create({
      data: {
        hospitalId: h.id,
        classificationId: c.id,
        createdById: admin.id,
        treatment: 'TAXABLE',
        ratePercent: '12.00',
        priceIncludesTax: true,
        effectiveFrom: await day(5),
      },
    });
    const seen = await prisma.$transaction(async (tx) => {
      await tx.taxClassificationVersion.update({
        where: { id: v.id },
        data: { ratePercent: '5.00' },
      });
      const locked = reader.$queryRaw`SELECT 1 FROM tax_classifications WHERE id = ${c.id}::uuid FOR SHARE NOWAIT`;
      await expect(locked).rejects.toThrow(/could not obtain lock/);
      // Every writer takes the hospital row first (fixed lock order).
      await expect(
        reader.$queryRaw`SELECT 1 FROM hospitals WHERE id = ${h.id}::uuid FOR SHARE NOWAIT`,
      ).rejects.toThrow(/could not obtain lock/);
      const plain = await reader.taxClassificationVersion.findUniqueOrThrow({
        where: { id: v.id },
      });
      return plain.ratePercent.toFixed(2);
    });
    expect(seen).toBe('12.00');
    await expect(
      reader.$queryRaw`SELECT 1 FROM tax_classifications WHERE id = ${c.id}::uuid FOR SHARE NOWAIT`,
    ).resolves.toHaveLength(1);
  });

  it('a registration writer locks its hospital row without blocking foreign-key inserts', async () => {
    const { h, admin } = await hospitalWithAdmin();
    // Stamp the time zone lock first, so the only hospital-row lock inside the transaction below is
    // the one revision 3 adds.
    const c = await classification(h.id, admin.id, 'GOODS');
    await prisma.taxClassificationVersion.create({
      data: {
        hospitalId: h.id,
        classificationId: c.id,
        createdById: admin.id,
        treatment: 'TAXABLE',
        ratePercent: '5.00',
        priceIncludesTax: true,
        effectiveFrom: await day(5),
      },
    });
    await prisma.$transaction(async (tx) => {
      await tx.hospitalGstRegistration.create({
        data: {
          hospitalId: h.id,
          attestedById: admin.id,
          registrationType: 'UNREGISTERED',
          effectiveFrom: await day(5),
        },
      });
      await expect(
        reader.$queryRaw`SELECT 1 FROM hospitals WHERE id = ${h.id}::uuid FOR SHARE NOWAIT`,
      ).rejects.toThrow(/could not obtain lock/);
      // Foreign-key checks take KEY SHARE, which FOR NO KEY UPDATE does not block.
      await expect(
        reader.department.create({ data: { hospitalId: h.id, name: `int-dept-${uid()}` } }),
      ).resolves.toBeDefined();
    });
    await expect(
      reader.$queryRaw`SELECT 1 FROM hospitals WHERE id = ${h.id}::uuid FOR SHARE NOWAIT`,
    ).resolves.toHaveLength(1);
  });
});

describe('T-MIG-TAX-012: an inactive classification gets no new versions (revision 4)', () => {
  it('refuses a new version, keeps recorded ones, and still allows a future one to be withdrawn', async () => {
    const { h, admin } = await hospitalWithAdmin();
    const c = await classification(h.id, admin.id, 'GOODS');
    const version = (effectiveFrom: Date, ratePercent: string) =>
      prisma.taxClassificationVersion.create({
        data: {
          hospitalId: h.id,
          classificationId: c.id,
          createdById: admin.id,
          treatment: 'TAXABLE',
          ratePercent,
          priceIncludesTax: true,
          effectiveFrom,
        },
      });
    await version(await day(0), '5.00');
    const future = await version(await day(5), '12.00');
    await prisma.taxClassification.update({ where: { id: c.id }, data: { isActive: false } });
    await expect(version(await day(9), '18.00')).rejects.toThrow(
      /cannot be added to an inactive classification/,
    );
    expect(await prisma.taxClassificationVersion.count({ where: { classificationId: c.id } })).toBe(
      2,
    );
    await expect(
      prisma.taxClassificationVersion.delete({ where: { id: future.id } }),
    ).resolves.toBeDefined();
  });
});

describe('T-MIG-TAX-013: assigning a classification serialises with its deactivation (revision 4)', () => {
  // A second connection plays the concurrent session. NOWAIT and lock_timeout keep the checks
  // independent of timing.
  const other = new PrismaClient();
  afterAll(() => other.$disconnect());

  it('an open default assignment holds the hospital row and the classification row', async () => {
    const { h, admin } = await hospitalWithAdmin();
    const service = await classification(h.id, admin.id, 'SERVICE');
    await prisma.$transaction(async (tx) => {
      await tx.hospitalTaxDefault.create({
        data: {
          hospitalId: h.id,
          kind: 'CONSULTATION',
          classificationId: service.id,
          updatedById: admin.id,
        },
      });
      await expect(
        other.$queryRaw`SELECT 1 FROM hospitals WHERE id = ${h.id}::uuid FOR SHARE NOWAIT`,
      ).rejects.toThrow(/could not obtain lock/);
      // The concurrent deactivation has to wait; it gives up after a short lock timeout.
      await expect(
        other.$transaction(async (o) => {
          await o.$executeRawUnsafe("SET LOCAL lock_timeout = '300ms'");
          await o.taxClassification.update({
            where: { id: service.id },
            data: { isActive: false },
          });
        }),
      ).rejects.toThrow(/lock timeout/);
    });
    // Once the assignment has committed, the deactivation sees it and is refused.
    await expect(
      other.taxClassification.update({ where: { id: service.id }, data: { isActive: false } }),
    ).rejects.toThrow(/used as a hospital default/);
    const after = await prisma.taxClassification.findUniqueOrThrow({ where: { id: service.id } });
    expect(after.isActive).toBe(true);
  });

  it('an assignment made while a deactivation is open waits and is then refused', async () => {
    const { h, admin } = await hospitalWithAdmin();
    const service = await classification(h.id, admin.id, 'SERVICE');
    await prisma.$transaction(async (tx) => {
      await tx.taxClassification.update({ where: { id: service.id }, data: { isActive: false } });
      await expect(
        other.$transaction(async (o) => {
          await o.$executeRawUnsafe("SET LOCAL lock_timeout = '300ms'");
          await o.hospitalTaxDefault.create({
            data: {
              hospitalId: h.id,
              kind: 'LAB',
              classificationId: service.id,
              updatedById: admin.id,
            },
          });
        }),
      ).rejects.toThrow(/lock timeout/);
    });
    await expect(
      other.hospitalTaxDefault.create({
        data: {
          hospitalId: h.id,
          kind: 'LAB',
          classificationId: service.id,
          updatedById: admin.id,
        },
      }),
    ).rejects.toThrow(/inactive tax classification cannot be assigned/);
  });
});
