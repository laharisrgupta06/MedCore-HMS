import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AUTH_COOKIES, CSRF_HEADER, addDays, isValidGstin, type Role } from '@medcore/types';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SessionStore } from '../src/common/auth/session.store';
import { TokenService } from '../src/common/auth/token.service';
import { localDate } from '../src/common/time/zoned';

/**
 * Tax settings API on real PostgreSQL (task 8-B2, T-TAX-API-001..009). Drives the routes through the
 * full guard pipeline against the M-11a rules: role checks, tenant isolation, translated rule
 * refusals, the GSTIN exclusion without leaking the other hospital, the time zone lock and
 * concurrent writes. Creates rows prefixed "int-tx-"; tax rows are never deleted by design.
 */
const prisma = new PrismaClient();
const run = randomBytes(3).toString('hex');
const CSRF = 't'.repeat(43);
const TZ = 'Asia/Kolkata';
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function gstin(): string {
  const r = randomBytes(8);
  const letter = (b: number) => ALPHABET[10 + (b % 26)]!;
  const serial = String(1 + (r.readUInt16BE(6) % 9999)).padStart(4, '0');
  const holder = 'ABCFGHJLPT'[r[3]! % 10]!;
  const first14 = `29${letter(r[0]!)}${letter(r[1]!)}${letter(r[2]!)}${holder}${letter(r[4]!)}${serial}${letter(r[5]!)}1Z`;
  let s = 0;
  for (let i = 0; i < 14; i++) {
    const p = ALPHABET.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    s += Math.floor(p / 36) + (p % 36);
  }
  return first14 + ALPHABET[(36 - (s % 36)) % 36];
}

describe('Phase 8 integration: tax settings API on PostgreSQL', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<
      { t: string | null }[]
    >`SELECT to_regclass('public.tax_classifications')::text AS t`;
    if (!rows[0]?.t)
      throw new Error('M-11a not applied: the tax_classifications table does not exist.');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app, { corsOrigins: ['http://localhost:3000'] });
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('manages classifications, defaults and registrations within the database rules', async () => {
    let n = 0;
    const hospital = (tag: string) =>
      prisma.hospital.create({
        data: {
          name: `int-tx-${tag}-${run}`,
          code: `INTTX${tag}-${run}`.toUpperCase(),
          email: `int-tx-${tag}-${run}@example.com`,
          phone: '+918000000001',
          licenseNumber: `LT-${tag}-${run}`,
          status: 'VERIFIED',
          timezone: TZ,
        },
      });
    const A = await hospital('a');
    const B = await hospital('b');
    const staff = (hid: string, role: Role) =>
      prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            hospitalId: hid,
            email: `int-tx-${role.toLowerCase()}-${++n}-${run}@example.com`,
            passwordHash: 'x',
            role,
            firstName: 'Int',
            lastName: `${role}${n}`,
            emailVerifiedAt: new Date(),
          },
        });
        await tx.staffProfile.create({ data: { hospitalId: hid, userId: u.id } });
        return u;
      });
    const tokens = app.get(TokenService);
    const sessions = app.get(SessionStore);
    const client = async (id: string, role: Role, hid: string) => {
      const sid = randomUUID();
      await sessions.create(id, sid, randomUUID(), 60_000);
      const auth = `Bearer ${await tokens.signAccess({ sub: id, sid, role, hid })}`;
      const s = app.getHttpServer();
      const w = (r: request.Test) =>
        r
          .set('Authorization', auth)
          .set('Cookie', `${AUTH_COOKIES.csrf}=${CSRF}`)
          .set(CSRF_HEADER, CSRF);
      return {
        get: (url: string) => request(s).get(url).set('Authorization', auth),
        post: (url: string, body: object = {}) => w(request(s).post(url)).send(body),
        patch: (url: string, body: object = {}) => w(request(s).patch(url)).send(body),
        put: (url: string, body: object = {}) => w(request(s).put(url)).send(body),
        del: (url: string) => w(request(s).delete(url)),
      };
    };
    const a = await client((await staff(A.id, 'HOSPITAL_ADMIN')).id, 'HOSPITAL_ADMIN', A.id);
    const b = await client((await staff(B.id, 'HOSPITAL_ADMIN')).id, 'HOSPITAL_ADMIN', B.id);
    const acc = await client((await staff(A.id, 'ACCOUNTANT')).id, 'ACCOUNTANT', A.id);
    // ---- T-TAX-API-001: empty settings; accountant reads but cannot write ----------------------
    const empty = (await acc.get('/api/tax/settings').expect(200)).body.data;
    expect(empty).toMatchObject({
      timezone: TZ,
      timezoneLocked: false,
      setupConfirmedAt: null,
      classifications: [],
      registrations: [],
    });
    expect(empty.roomRules.length).toBeGreaterThanOrEqual(1);
    // Dates are relative to the hospital's tax date (local date ten minutes ahead), as the rules are.
    expect([
      localDate(new Date(), TZ),
      localDate(new Date(Date.now() + 10 * 60_000), TZ),
    ]).toContain(empty.taxDate);
    const today: string = empty.taxDate;
    const later = addDays(today, 30);
    await acc
      .post('/api/tax/classifications', { name: 'x', supplyType: 'SERVICE', hsnSac: '999312' })
      .expect(403);
    // Reading never stamps the time zone lock (medcore_tax_date is not called on reads).
    expect(
      (await prisma.hospital.findUniqueOrThrow({ where: { id: A.id } })).taxTimezoneLockedAt,
    ).toBeNull();

    // ---- T-TAX-API-002: classifications and versions -------------------------------------------
    const cls = async (name: string, supplyType: 'GOODS' | 'SERVICE', hsnSac: string) =>
      (await a.post('/api/tax/classifications', { name, supplyType, hsnSac }).expect(201)).body.data
        .id as string;
    const consult = await cls('Consultation (exempt)', 'SERVICE', '999312');
    const lab = await cls('Diagnostics (exempt)', 'SERVICE', '999316');
    const meds = await cls('Medicaments 12%', 'GOODS', '3004');
    expect(
      (
        await a
          .post('/api/tax/classifications', { name: 'Bad', supplyType: 'GOODS', hsnSac: '9993' })
          .expect(400)
      ).body.error.code,
    ).toBe('HSN_SAC_INVALID');
    await a
      .post(`/api/tax/classifications/${consult}/versions`, {
        treatment: 'EXEMPT',
        ratePercent: '0',
        priceIncludesTax: false,
        effectiveFrom: today,
      })
      .expect(201);
    await a
      .post(`/api/tax/classifications/${lab}/versions`, {
        treatment: 'EXEMPT',
        ratePercent: '0',
        priceIncludesTax: false,
        effectiveFrom: today,
      })
      .expect(201);
    const fut = (
      await a
        .post(`/api/tax/classifications/${meds}/versions`, {
          treatment: 'TAXABLE',
          ratePercent: '12',
          priceIncludesTax: true,
          effectiveFrom: later,
        })
        .expect(201)
    ).body.data.id;
    expect(
      (
        await a
          .post(`/api/tax/classifications/${meds}/versions`, {
            treatment: 'TAXABLE',
            ratePercent: '0',
            priceIncludesTax: false,
            effectiveFrom: later,
          })
          .expect(400)
      ).body.error.code,
    ).toBe('RATE_INVALID');
    // A version starting before the tax date is refused by the database rule, with its own message.
    const back = await a
      .post(`/api/tax/classifications/${meds}/versions`, {
        treatment: 'TAXABLE',
        ratePercent: '5',
        priceIncludesTax: false,
        effectiveFrom: addDays(today, -3),
      })
      .expect(409);
    expect(back.body.error.code).toBe('RULE_VIOLATION');
    // A future version can be corrected and withdrawn (DEC-059).
    await a
      .patch(`/api/tax/versions/${fut}`, { ratePercent: '5', treatment: 'TAXABLE' })
      .expect(200);
    const s1 = (await a.get('/api/tax/settings').expect(200)).body.data;
    const medsView = s1.classifications.find((c: { id: string }) => c.id === meds);
    expect(medsView.versions).toEqual([
      expect.objectContaining({
        id: fut,
        ratePercent: '5.00',
        priceIncludesTax: true,
        editable: true,
        inForce: false,
      }),
    ]);
    expect(s1.timezoneLocked).toBe(true); // tax dates now exist
    await a.del(`/api/tax/versions/${fut}`).expect(200);

    // ---- T-TAX-API-003: the time zone is locked (DEC-057) -------------------------------------
    const tz = await a.patch(`/api/hospitals/${A.id}`, { timezone: 'Europe/London' }).expect(409);
    expect(tz.body.error.code).toBe('TIMEZONE_LOCKED');
    expect(
      (await a.patch(`/api/hospitals/${A.id}`, { timezone: TZ }).expect(200)).body.data
        .timezoneLocked,
    ).toBe(true);
    expect(
      (await b.patch(`/api/hospitals/${B.id}`, { timezone: 'Asia/Atlantis' }).expect(400)).body
        .error.code,
    ).toBe('VALIDATION_ERROR');

    // ---- T-TAX-API-004: defaults, confirmation, deactivation guard -----------------------------
    expect((await a.post('/api/tax/confirm').expect(400)).body.error.code).toBe('DEFAULTS_MISSING');
    await a.put('/api/tax/defaults/CONSULTATION', { classificationId: consult }).expect(200);
    await a.put('/api/tax/defaults/LAB', { classificationId: lab }).expect(200);
    expect(
      (await a.put('/api/tax/defaults/LAB', { classificationId: meds }).expect(409)).body.error
        .code,
    ).toBe('RULE_VIOLATION'); // goods cannot be a lab default
    await a.put('/api/tax/defaults/ROOM', { classificationId: lab }).expect(400);
    await b.put('/api/tax/defaults/LAB', { classificationId: lab }).expect(404); // A's classification
    expect((await a.post('/api/tax/confirm').expect(201)).body.data.setupConfirmedAt).toEqual(
      expect.any(String),
    );
    expect(
      (await a.patch(`/api/tax/classifications/${consult}`, { isActive: false }).expect(409)).body
        .error.code,
    ).toBe('RULE_VIOLATION');
    await a.patch(`/api/tax/classifications/${consult}`, { name: 'Consultations' }).expect(200);

    // ---- T-TAX-API-005: item assignments --------------------------------------------------------
    const med = await prisma.medicine.create({
      data: {
        hospitalId: A.id,
        name: `int-tx-${run}`,
        form: 'TABLET',
        strength: '1 mg',
        reorderLevel: 1,
      },
    });
    await a.put(`/api/tax/assignments/medicines/${med.id}`, { classificationId: meds }).expect(200);
    expect(
      (await prisma.medicine.findUniqueOrThrow({ where: { id: med.id } })).taxClassificationId,
    ).toBe(meds);
    expect(
      (
        await a
          .put(`/api/tax/assignments/medicines/${med.id}`, { classificationId: consult })
          .expect(409)
      ).body.error.code,
    ).toBe('RULE_VIOLATION');
    await a.put(`/api/tax/assignments/medicines/${med.id}`, { classificationId: null }).expect(200);

    // ---- T-TAX-API-006: GST registrations ----------------------------------------------------
    const g = gstin();
    expect(isValidGstin(g)).toBe(true);
    expect(
      (
        await a
          .post('/api/tax/registrations', {
            registrationType: 'REGULAR',
            gstin: g.slice(0, 14) + 'A',
            legalName: 'L',
            effectiveFrom: later,
          })
          .expect(400)
      ).body.error.code,
    ).toBe('GSTIN_INVALID');
    const reg = (
      await a
        .post('/api/tax/registrations', {
          registrationType: 'REGULAR',
          gstin: g.toLowerCase(),
          legalName: 'Int Hospitals LLP',
          effectiveFrom: later,
        })
        .expect(201)
    ).body.data.id;
    const s2 = (await a.get('/api/tax/settings').expect(200)).body.data;
    expect(s2.registrations).toEqual([
      expect.objectContaining({
        id: reg,
        gstin: g,
        stateCode: '29',
        deletable: true,
        inForce: false,
      }),
    ]);
    expect(
      (
        await a
          .post('/api/tax/registrations', {
            registrationType: 'UNREGISTERED',
            effectiveFrom: addDays(today, -1),
          })
          .expect(409)
      ).body.error.code,
    ).toBe('RULE_VIOLATION');
    // T-TAX-API-007: another hospital cannot take the GSTIN, and learns nothing about who has it.
    const taken = await b
      .post('/api/tax/registrations', {
        registrationType: 'REGULAR',
        gstin: g,
        legalName: 'Other',
        effectiveFrom: later,
      })
      .expect(409);
    expect(taken.body.error.code).toBe('GSTIN_UNAVAILABLE');
    expect(JSON.stringify(taken.body)).not.toContain(A.id);
    await a.del(`/api/tax/registrations/${reg}`).expect(200);

    // ---- T-TAX-API-008: tenant isolation -----------------------------------------------------
    await b.patch(`/api/tax/classifications/${meds}`, { name: 'stolen' }).expect(404);
    await b
      .post(`/api/tax/classifications/${meds}/versions`, {
        treatment: 'EXEMPT',
        ratePercent: '0',
        priceIncludesTax: false,
        effectiveFrom: later,
      })
      .expect(404);
    await b.put(`/api/tax/assignments/medicines/${med.id}`, { classificationId: null }).expect(404);
    const bMed = await prisma.medicine.create({
      data: {
        hospitalId: B.id,
        name: `int-tx-b-${run}`,
        form: 'TABLET',
        strength: '1 mg',
        reorderLevel: 1,
      },
    });
    await b
      .put(`/api/tax/assignments/medicines/${bMed.id}`, { classificationId: meds })
      .expect(404);
    expect((await b.get('/api/tax/settings').expect(200)).body.data.classifications).toEqual([]);

    // ---- T-TAX-API-009: concurrent writes never produce a 500 --------------------------------
    const same = await Promise.all(
      Array.from({ length: 6 }, () =>
        a.post(`/api/tax/classifications/${meds}/versions`, {
          treatment: 'TAXABLE',
          ratePercent: '12',
          priceIncludesTax: true,
          effectiveFrom: addDays(today, 40),
        }),
      ),
    );
    expect(same.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409, 409]);
  });
});
