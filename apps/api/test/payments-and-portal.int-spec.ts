import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AUTH_COOKIES, CSRF_HEADER, type Role } from '@medcore/types';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SessionStore } from '../src/common/auth/session.store';
import { TokenService } from '../src/common/auth/token.service';
import { localDate } from '../src/common/time/zoned';
import { PAYMENT_ADAPTER } from '../src/modules/payments/providers/payment-adapter';
import {
  FakeProvider,
  TEST_SIGNATURE_HEADER,
} from '../src/modules/payments/providers/fake-provider';

/**
 * Phases 8 to 11 through the API on PostgreSQL with M-12, M-13 and M-15 (T-PAY-INT-001).
 * One issued invoice is paid in part by cash, then by an online checkout whose webhook arrives
 * twice, partly reversed, settled by an insurer (TPA), reconciled and receipted; the notifications
 * those steps write, the analytics totals, global search and the patient portal are then checked,
 * with another patient and another hospital seeing none of it. Uses the development test provider
 * (FakeProvider): no real payment service is contacted. Rows stay in this test's own hospitals
 * ("int-pay-"); payments and invoices are never deleted (DEC-053). Run before 23:50 India time.
 */
const prisma = new PrismaClient();
const run = randomBytes(3).toString('hex');
const CSRF = 'p'.repeat(43);
const TZ = 'Asia/Kolkata';

describe('Phases 8-11 integration: payments, claims, notifications, analytics and portal on PostgreSQL', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM pg_trigger WHERE tgname = 'payments_invoice_status'`;
    if (!rows[0]?.n) throw new Error('M-12 not applied: payments_invoice_status does not exist.');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app, { corsOrigins: ['http://localhost:3000'] });
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('pays, reverses, settles, reconciles, receipts, notifies and reports one invoice, isolated by patient and hospital', async () => {
    // ---- Two hospitals; hospital A has a minimal tax set-up so a consultation can be invoiced.
    let n = 0;
    const hospital = (tag: string) =>
      prisma.hospital.create({
        data: {
          name: `int-pay-${tag}-${run}`,
          code: `INTP${tag}-${run}`.toUpperCase(),
          email: `int-pay-${tag}-${run}@example.com`,
          phone: '+918000000003',
          licenseNumber: `LP-${tag}-${run}`,
          status: 'VERIFIED',
          timezone: TZ,
        },
      });
    const A = await hospital('a');
    const B = await hospital('b');
    const user = (hid: string, role: Role) =>
      prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            hospitalId: hid,
            email: `int-pay-${role.toLowerCase()}-${++n}-${run}@example.com`,
            passwordHash: 'x',
            role,
            firstName: 'Int',
            lastName: `${role}${n}`,
            emailVerifiedAt: new Date(),
          },
        });
        if (role === 'DOCTOR')
          await tx.doctor.create({
            data: {
              hospitalId: hid,
              userId: u.id,
              registrationNumber: `RP-${run}-${n}`,
              specialisation: 'General',
              consultationFee: 500,
            },
          });
        else if (role === 'PATIENT')
          await tx.patient.create({
            data: {
              hospitalId: hid,
              userId: u.id,
              mrn: `INTP-${run}-${n}`,
              dateOfBirth: new Date('1990-01-01'),
              gender: 'FEMALE',
            },
          });
        else await tx.staffProfile.create({ data: { hospitalId: hid, userId: u.id } });
        return u;
      });
    const adminU = await user(A.id, 'HOSPITAL_ADMIN');
    const rcU = await user(A.id, 'RECEPTIONIST');
    const acU = await user(A.id, 'ACCOUNTANT');
    const drU = await user(A.id, 'DOCTOR');
    const ptU = await user(A.id, 'PATIENT');
    const pt2U = await user(A.id, 'PATIENT');
    const adminB = await user(B.id, 'HOSPITAL_ADMIN');
    const rcB = await user(B.id, 'RECEPTIONIST');

    const [taxRow] = await prisma.$queryRaw<
      { d: Date }[]
    >`SELECT medcore_tax_date(${A.id}::uuid) AS d`;
    const today = taxRow!.d.toISOString().slice(0, 10);
    expect(today).toBe(localDate(new Date(), TZ)); // run before 23:50 India time
    const svc = await prisma.taxClassification.create({
      data: {
        hospitalId: A.id,
        name: `Healthcare services ${run}`,
        supplyType: 'SERVICE',
        hsnSac: '999312',
        createdById: adminU.id,
      },
    });
    await prisma.taxClassificationVersion.create({
      data: {
        hospitalId: A.id,
        classificationId: svc.id,
        treatment: 'EXEMPT',
        ratePercent: 0,
        priceIncludesTax: false,
        effectiveFrom: new Date(`${today}T00:00:00Z`),
        createdById: adminU.id,
      },
    });
    for (const kind of ['CONSULTATION', 'LAB'] as const)
      await prisma.hospitalTaxDefault.create({
        data: {
          hospitalId: A.id,
          kind,
          classificationId: svc.id,
          updatedById: adminU.id,
          updatedAt: new Date(),
        },
      });
    const dept = await prisma.department.create({
      data: { hospitalId: A.id, name: `General ${run}` },
    });
    const doctor = await prisma.doctor.findFirstOrThrow({ where: { userId: drU.id } });
    const patient = await prisma.patient.findFirstOrThrow({ where: { userId: ptU.id } });
    const start = new Date();
    const appt = await prisma.appointment.create({
      data: {
        hospitalId: A.id,
        doctorId: doctor.id,
        patientId: patient.id,
        departmentId: dept.id,
        scheduledAt: start,
        endAt: new Date(start.getTime() + 900_000),
        status: 'IN_PROGRESS',
        createdById: rcU.id,
      },
    });
    await prisma.medicalRecord.create({
      data: { hospitalId: A.id, appointmentId: appt.id, chiefComplaint: 'Fever' },
    });

    const tokens = app.get(TokenService);
    const sessions = app.get(SessionStore);
    const server = app.getHttpServer();
    const client = async (id: string, role: Role, hid: string) => {
      const sid = randomUUID();
      await sessions.create(id, sid, randomUUID(), 60_000);
      const auth = `Bearer ${await tokens.signAccess({ sub: id, sid, role, hid })}`;
      const w = (r: request.Test) =>
        r
          .set('Authorization', auth)
          .set('Cookie', `${AUTH_COOKIES.csrf}=${CSRF}`)
          .set(CSRF_HEADER, CSRF);
      return {
        get: (url: string) => request(server).get(url).set('Authorization', auth),
        post: (url: string, body: object = {}) => w(request(server).post(url)).send(body),
        patch: (url: string, body: object = {}) => w(request(server).patch(url)).send(body),
      };
    };
    const admin = await client(adminU.id, 'HOSPITAL_ADMIN', A.id);
    const rc = await client(rcU.id, 'RECEPTIONIST', A.id);
    const ac = await client(acU.id, 'ACCOUNTANT', A.id);
    const dr = await client(drU.id, 'DOCTOR', A.id);
    const pt = await client(ptU.id, 'PATIENT', A.id);
    const pt2 = await client(pt2U.id, 'PATIENT', A.id);
    const aB = await client(adminB.id, 'HOSPITAL_ADMIN', B.id);
    const rB = await client(rcB.id, 'RECEPTIONIST', B.id);

    // ---- The consultation is charged when the visit completes; the invoice is issued.
    await dr.patch(`/api/appointments/${appt.id}/status`, { status: 'COMPLETED' }).expect(200);
    const [draft] = (await rc.get(`/api/invoices?patientId=${patient.id}`).expect(200)).body.data;
    // The admin records the GST status and confirms the tax set-up before the first invoice.
    await admin
      .post('/api/tax/registrations', { registrationType: 'UNREGISTERED', effectiveFrom: today })
      .expect(201);
    await admin.post('/api/tax/confirm').expect((r) => expect(r.status).toBeLessThan(300));
    const inv = (await rc.patch(`/api/invoices/${draft.id}/finalise`).expect(200)).body.data;
    expect(inv).toMatchObject({ status: 'FINALISED', total: '500.00' });
    const payments = (c: typeof rc) => c.get(`/api/invoices/${inv.id}/payments`);

    // ---- T-PAY-INT-001a: who may see the payments of this invoice.
    expect((await payments(pt).expect(200)).body.data).toMatchObject({
      balance: '500.00',
      payments: [],
    });
    await payments(pt2).expect(404);
    await payments(rB).expect(404);
    await payments(dr).expect(403);

    // ---- b: cash in part; the database keeps the invoice status (M-12); overpaying is refused.
    await dr.post(`/api/invoices/${inv.id}/payments/cash`, { amount: '200.00' }).expect(403);
    const afterCash = (
      await rc.post(`/api/invoices/${inv.id}/payments/cash`, { amount: '200.00' }).expect(201)
    ).body.data;
    const cash = afterCash.payments[0];
    expect(cash).toMatchObject({ method: 'CASH', status: 'SUCCEEDED', amount: '200.00' });
    expect((await payments(rc).expect(200)).body.data).toMatchObject({
      invoiceStatus: 'PARTIALLY_PAID',
      paid: '200.00',
      balance: '300.00',
    });
    expect(
      (await rc.post(`/api/invoices/${inv.id}/payments/cash`, { amount: '300.01' }).expect(409))
        .body.error.code,
    ).toBe('AMOUNT_EXCEEDS_BALANCE');

    // ---- c: online checkout for the balance; the provider webhook is verified and idempotent.
    const started = (
      await rc
        .post(`/api/invoices/${inv.id}/payments/checkout`, { method: 'STRIPE_CARD' })
        .expect(201)
    ).body.data;
    expect(started.payment).toMatchObject({
      status: 'PENDING',
      amount: '300.00',
      checkoutOpen: true,
    });
    const online = await prisma.payment.findUniqueOrThrow({ where: { id: started.payment.id } });
    const fake = app.get(PAYMENT_ADAPTER);
    expect(fake).toBeInstanceOf(FakeProvider);
    const event = (fake as FakeProvider).signedEvent({
      provider: 'STRIPE',
      eventId: `evt_${run}`,
      providerReference: online.providerReference!,
      outcome: 'SUCCEEDED',
      amount: '300.00',
    });
    const webhook = (signature: string) =>
      request(server)
        .post('/api/payments/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set(TEST_SIGNATURE_HEADER, signature)
        .send(event.body);
    expect((await webhook('0'.repeat(64)).expect(400)).body.error.code).toBe('WEBHOOK_INVALID');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: online.id } })).status).toBe(
      'PENDING',
    );
    const first = await webhook(event.signature);
    const again = await webhook(event.signature);
    expect(first.status).toBeLessThan(300);
    expect(again.status).toBeLessThan(300);
    expect(await prisma.webhookEvent.count({ where: { eventId: `evt_${run}` } })).toBe(1);
    expect((await payments(rc).expect(200)).body.data).toMatchObject({
      invoiceStatus: 'PAID',
      paid: '500.00',
      balance: '0.00',
      openCheckoutId: null,
    });

    // ---- d: receipts: staff and the paying patient only.
    const receipt = await rc.get(`/api/payments/${cash.id}/receipt`).expect(200);
    expect(receipt.headers['content-type']).toMatch(/application\/pdf/);
    await pt.get(`/api/payments/${cash.id}/receipt`).expect(200);
    await pt2.get(`/api/payments/${cash.id}/receipt`).expect(404);
    await rB.get(`/api/payments/${cash.id}/receipt`).expect(404);

    // ---- e: reconciliation, then reversal: only the accountant, never a reconciled payment.
    const rec = (await ac.get(`/api/reconciliation?from=${today}&to=${today}`).expect(200)).body
      .data;
    expect(JSON.stringify(rec)).toContain(cash.id);
    await ac.post('/api/reconciliation/mark', { paymentIds: [cash.id] }).expect((r) => {
      expect(r.status).toBeLessThan(300);
    });
    const reverse = (c: typeof rc, id: string) =>
      c.post(`/api/payments/${id}/reverse`, { reason: 'Card payment disputed by the bank' });
    await reverse(rc, online.id).expect(403);
    expect((await reverse(ac, cash.id).expect(409)).body.error.code).toBe('RECONCILED_PAYMENT');
    await reverse(ac, online.id).expect((r) => expect(r.status).toBeLessThan(300));
    const reversed = await prisma.payment.findUniqueOrThrow({ where: { id: online.id } });
    expect(reversed).toMatchObject({ status: 'REVERSED', reversedById: acU.id });
    expect(reversed.reversedAt).not.toBeNull();
    expect((await payments(rc).expect(200)).body.data).toMatchObject({
      invoiceStatus: 'PARTIALLY_PAID',
      balance: '300.00',
    });

    // ---- f: an insurer (TPA) settles the balance through an approved claim (M-13).
    const claim = (
      await rc
        .post(`/api/invoices/${inv.id}/claims`, {
          tpaName: 'Int Health TPA',
          policyNumber: `POL-${run}`,
          claimAmount: '300.00',
        })
        .expect(201)
    ).body.data;
    await ac.patch(`/api/claims/${claim.id}/decision`, { decision: 'APPROVED' }).expect(200);
    await ac
      .post(`/api/claims/${claim.id}/settle`, { settledAmount: '300.00', postToBalance: true })
      .expect((r) => expect(r.status).toBeLessThan(300));
    const tpa = await prisma.payment.findFirstOrThrow({
      where: { invoiceId: inv.id, method: 'TPA_SETTLEMENT' },
    });
    expect(tpa).toMatchObject({ status: 'SUCCEEDED', provider: null });
    expect(tpa.amount.toFixed(2)).toBe('300.00');
    expect(
      (await prisma.insuranceClaim.findUniqueOrThrow({ where: { id: claim.id } })).status,
    ).toBe('SETTLED');
    const after = (await payments(rc).expect(200)).body.data;
    expect(after).toMatchObject({ invoiceStatus: 'PAID', balance: '0.00', openCheckoutId: null });
    // A TPA settlement is not an online checkout (no provider, never "open").
    expect(after.payments.find((p: { id: string }) => p.id === tpa.id)).toMatchObject({
      method: 'TPA_SETTLEMENT',
      checkoutOpen: false,
    });

    // ---- g: the patient's own payment history; another patient sees none of it.
    const mine = (await pt.get('/api/payments/mine').expect(200)).body.data;
    expect(JSON.stringify(mine)).toContain(cash.id);
    expect(
      JSON.stringify((await pt2.get('/api/payments/mine').expect(200)).body.data),
    ).not.toContain(cash.id);

    // ---- h: notifications were written with the business change, once each, with M-15 keys.
    const rows = await prisma.notification.findMany({
      where: { recipientId: ptU.id },
      include: { deliveries: true },
    });
    const byType = (t: string) => rows.filter((r) => r.type === t);
    expect(byType('invoice.issued')).toHaveLength(1);
    expect(byType('invoice.issued')[0]!.dedupeKey).toBe(`invoice.issued:${inv.id}`);
    expect(byType('payment.received').length).toBeGreaterThanOrEqual(2);
    for (const r of rows) expect(r.deliveries.length).toBeGreaterThan(0);
    const unread = async (c: typeof pt) =>
      (await c.get('/api/notifications/unread-count').expect(200)).body.data.unread;
    expect(await unread(pt)).toBe(rows.length);
    const list = (await pt.get('/api/notifications').expect(200)).body.data;
    const one = (list.items ?? list)[0];
    await pt2.patch(`/api/notifications/${one.id}/read`).expect(404);
    await pt.patch(`/api/notifications/${one.id}/read`).expect(200);
    expect(await unread(pt)).toBe(rows.length - 1);
    await pt.post('/api/notifications/read-all').expect((r) => expect(r.status).toBeLessThan(300));
    expect(await unread(pt)).toBe(0);
    expect(await unread(pt2)).toBe(0);

    // ---- i: analytics from the records themselves, per hospital.
    const ops = (await admin.get(`/api/analytics/operations?from=${today}&to=${today}`).expect(200))
      .body.data;
    expect(ops.billing).toMatchObject({
      invoicesIssued: 1,
      received: '500.00',
      outstanding: '0.00',
    });
    const byMethod = Object.fromEntries(
      ops.billing.receivedByMethod.map((m: { method: string; amount: string }) => [
        m.method,
        m.amount,
      ]),
    );
    expect(byMethod).toEqual({ CASH: '200.00', TPA_SETTLEMENT: '300.00' }); // the reversed payment is not counted
    const overview = (
      await admin.get(`/api/analytics/overview?from=${today}&to=${today}`).expect(200)
    ).body.data;
    expect(overview.kpis).toMatchObject({ patientsTotal: 2, receivedToday: '500.00' });
    const otherOps = (
      await aB.get(`/api/analytics/operations?from=${today}&to=${today}`).expect(200)
    ).body.data;
    expect(otherOps.billing).toMatchObject({ invoicesIssued: 0, received: '0.00' });
    await pt.get(`/api/analytics/overview?from=${today}&to=${today}`).expect(403);
    await rc.get(`/api/analytics/overview?from=${today}&to=${today}`).expect(403);

    // ---- j: global search within the role and the hospital.
    const q = encodeURIComponent(patient.mrn);
    expect(JSON.stringify((await rc.get(`/api/search?q=${q}`).expect(200)).body.data)).toContain(
      patient.id,
    );
    expect(
      JSON.stringify((await rB.get(`/api/search?q=${q}`).expect(200)).body.data),
    ).not.toContain(patient.id);
    await pt.get(`/api/search?q=${q}`).expect(403);

    // ---- k: the patient dashboard shows the patient's own records only.
    const mySummary = JSON.stringify((await pt.get('/api/portal/summary').expect(200)).body.data);
    const otherSummary = JSON.stringify(
      (await pt2.get('/api/portal/summary').expect(200)).body.data,
    );
    expect(otherSummary).not.toContain(inv.id);
    expect(otherSummary).not.toContain(appt.id);
    expect(mySummary).not.toContain(pt2U.id);
    await rc.get('/api/portal/summary').expect(403);
  });
});
