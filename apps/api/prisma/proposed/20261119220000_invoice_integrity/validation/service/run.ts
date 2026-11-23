import 'reflect-metadata';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { BillingService } from './apps/api/src/modules/billing/billing.service';
import { scopeArgs } from './apps/api/src/common/tenancy/tenant-scope';

const url = process.env.DB_URL!;
const base = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const scoped = (h: string) =>
  base.$extends({
    query: {
      $allModels: {
        $allOperations: ({ model, operation, args, query }: any) =>
          query(scopeArgs(model, operation, args, h)),
      },
    },
  });
const A = 'aaaaaaaa-0000-0000-0000-000000000001',
  B = 'bbbbbbbb-0000-0000-0000-000000000001';
const who = (role: string, userId: string, h = A) =>
  ({ role, userId, hospitalId: h, sessionId: 's' }) as any;
const RC = who('RECEPTIONIST', 'aaaaaaaa-0000-0000-0000-0000000000a2');
const AC = who('ACCOUNTANT', 'aaaaaaaa-0000-0000-0000-0000000000a3');
const DR = who('DOCTOR', 'aaaaaaaa-0000-0000-0000-0000000000a4');
const PH = who('PHARMACIST', 'aaaaaaaa-0000-0000-0000-0000000000a5');
const PT = who('PATIENT', 'aaaaaaaa-0000-0000-0000-0000000000a6');
const RC_B = who('RECEPTIONIST', 'bbbbbbbb-0000-0000-0000-0000000000b2', B);
const V1 = 'aaaaaaaa-0000-0000-0000-00000000a001',
  V2 = 'aaaaaaaa-0000-0000-0000-00000000a002';
const LAB1 = 'aaaaaaaa-0000-0000-0000-00000000c201',
  LAB2 = 'aaaaaaaa-0000-0000-0000-00000000c202';
const DISP = 'aaaaaaaa-0000-0000-0000-00000000d401';
const svc = new BillingService({ client: scoped(A) } as any);
const svcB = new BillingService({ client: scoped(B) } as any);
let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
};
const code = async (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: any) => e?.response?.code ?? e?.status ?? String(e?.message).slice(0, 120),
  );
const inTx = (fn: (tx: any) => Promise<void>) => scoped(A).$transaction((tx: any) => fn(tx));

(async () => {
  // 1-2. Clinical actions charge the visit: consultation (doctor), lab test (doctor), dispense (pharmacist).
  await inTx((tx) => svc.charge(tx, DR, { kind: 'CONSULTATION', appointmentId: V1 }));
  await inTx((tx) =>
    svc.charge(tx, DR, {
      kind: 'LAB',
      appointmentId: V1,
      labOrderItemId: LAB1,
      description: 'Complete blood count',
    }),
  );
  await inTx((tx) =>
    svc.charge(tx, PH, {
      kind: 'PHARMACY',
      appointmentId: V1,
      dispenseId: DISP,
      description: 'Paracetamol 500 mg x 10',
    }),
  );
  const list1 = await svc.list(RC, { page: 1, limit: 20 });
  const d1 = await svc.get(RC, list1.items[0]!.id);
  check(
    'one draft for the visit with the three automatic charges',
    list1.items.length === 1 && d1.status === 'DRAFT' && d1.lines.length === 3,
    d1.lines.map((l) => `${l.kind} ${l.lineTotal}`).join(', '),
  );
  check(
    'tax snapshot: consultation and lab exempt, paracetamol 5% included',
    d1.lines[2]!.taxableValue === '114.29' &&
      d1.lines[2]!.taxAmount === '5.71' &&
      d1.taxAmount === '5.71' &&
      d1.total === '970.00',
    `subtotal ${d1.subtotal}, tax ${d1.taxAmount}, total ${d1.total}`,
  );
  check(
    "a doctor's second consultation charge is refused",
    (await code(inTx((tx) => svc.charge(tx, DR, { kind: 'CONSULTATION', appointmentId: V1 })))) ===
      'ALREADY_BILLED',
  );

  // 3. Discount (accountant), the plan's sharing rule.
  const disc = await svc.setDiscount(AC, d1.id, '62.00', 'Senior citizen concession');
  check(
    'accountant discount 62 shared and totals kept equal to the lines',
    disc.discountAmount === '62.00' &&
      disc.lines.map((l) => l.discountShare).join(',') === '31.96,22.37,7.67' &&
      disc.total === '908.00',
    `shares ${disc.lines.map((l) => l.discountShare).join('/')}, total ${disc.total}`,
  );
  check(
    'a receptionist cannot discount',
    (await code(svc.setDiscount(RC, d1.id, '10.00', 'x x x'))) === 'FORBIDDEN',
  );

  // 4-5. Void and replacement (decision 4).
  const v = await svc.void(RC, d1.id, 'Voided by mistake');
  check(
    'void keeps the draft and its lines, all released',
    v.status === 'VOID' &&
      v.lines.length === 3 &&
      v.lines.every((l) => l.releasedAt === v.voidedAt) &&
      v.invoiceNumber === null,
  );
  const d2 = await svc.createDraft(RC, V1);
  check(
    'replacement draft re-bills the released consultation, lab and pharmacy charges',
    d2.sequence === 2 &&
      d2.lines.map((l) => l.kind).join(',') === 'CONSULTATION,LAB,PHARMACY' &&
      d2.total === '970.00' &&
      d2.discountAmount === '0.00',
    `sequence ${d2.sequence}, ${d2.lines.map((l) => l.kind).join('/')}, total ${d2.total}`,
  );
  check(
    'a second draft for the visit is refused',
    (await code(svc.createDraft(RC, V1))) === 'INVOICE_EXISTS',
  );

  // 6. Finalise: gap-free number, document type, seller snapshot.
  const f = await svc.finalise(RC, d2.id);
  check(
    'finalised as an invoice-cum-bill of supply with the first number',
    f.status === 'FINALISED' &&
      f.documentType === 'INVOICE_CUM_BILL_OF_SUPPLY' &&
      /^ICB\/\d\d-\d\d\/00001$/.test(f.invoiceNumber ?? '') &&
      f.seller?.gstin === '27AAPFU0939F1ZV',
    `${f.invoiceNumber} ${f.documentType}`,
  );
  check(
    'the issued document cannot be voided (accountant guidance)',
    (await code(svc.void(RC, d2.id, 'Wrong patient'))) === 'DOCUMENT_ISSUED',
  );
  check(
    'the issued document cannot get a discount',
    (await code(svc.setDiscount(AC, d2.id, '5.00', 'Late concession'))) === 'NOT_DRAFT',
  );

  // 7-8. Late charges: a dispense after issue goes onto a late-charge invoice automatically.
  await inTx((tx) =>
    svc.charge(tx, DR, {
      kind: 'LAB',
      appointmentId: V1,
      labOrderItemId: LAB1,
      description: 'Complete blood count',
    }),
  ).catch(() => undefined);
  const late = await svc.createLateCharges(RC, d2.id);
  check(
    'late-charge draft follows the issued original',
    late.kind === 'LATE_CHARGES' && late.relatedInvoiceId === d2.id && late.lines.length === 0,
  );
  check(
    'the already billed lab test cannot be added to it again',
    (await code(
      inTx((tx) =>
        svc.charge(tx, DR, {
          kind: 'LAB',
          appointmentId: V1,
          labOrderItemId: LAB1,
          description: 'CBC',
        }),
      ),
    )) === 'ALREADY_BILLED',
  );
  const withRoom = await svc.addLine(RC, late.id, {
    kind: 'ROOM',
    roomId: 'aaaaaaaa-0000-0000-0000-00000000e001',
    days: 2,
    serviceDate: d1.lines[0]!.serviceDate,
  });
  check(
    'manual room charge: 6,000 a day for 2 days, 5% on the whole charge',
    withRoom.lines[0]!.taxAmount === '600.00' && withRoom.total === '12600.00',
    withRoom.total,
  );
  const lateF = await svc.finalise(RC, late.id);
  check(
    'late-charge invoice gets its own number; the original is unchanged',
    /^TI\/\d\d-\d\d\/00001$/.test(lateF.invoiceNumber ?? '') &&
      (await svc.get(RC, d2.id)).total === '970.00' &&
      (await svc.get(RC, d2.id)).lateChargeInvoiceIds[0] === late.id,
    lateF.invoiceNumber ?? '',
  );

  // 9. Correction request and accountant note.
  const cr = await svc.requestCorrection(
    RC,
    d2.id,
    'WRONG_DETAILS',
    'Patient address printed incorrectly',
  );
  check(
    'correction request recorded with the accountant guidance; document unchanged',
    /outside MedCore/.test(cr.message) &&
      cr.invoice.correctionRequests.length === 1 &&
      cr.invoice.invoiceNumber === f.invoiceNumber,
  );
  const noted = await svc.addCorrectionNote(
    AC,
    d2.id,
    cr.invoice.correctionRequests[0]!.id,
    'Handled outside MedCore',
    'CN-2026-0012',
  );
  check(
    'accountant outcome note added; balance and status unchanged',
    noted.correctionRequests[0]!.notes.length === 1 &&
      noted.status === 'FINALISED' &&
      noted.total === '970.00',
  );
  check(
    'history records creation, finalising and the correction request',
    ['CREATED', 'FINALISED', 'CORRECTION_REQUESTED'].every((k) =>
      noted.events.some((e) => e.kind === k),
    ),
  );

  // 10-11. Patient and tenant isolation.
  const mine = await svc.list(PT, { page: 1, limit: 20 });
  check(
    'the patient sees only their issued documents',
    mine.items.length === 2 && mine.items.every((i) => i.status === 'FINALISED'),
    mine.items.map((i) => i.invoiceNumber).join(', '),
  );
  check(
    'the patient cannot open the voided draft (404 NOT_FOUND)',
    (await code(svc.get(PT, d1.id))) === 'NOT_FOUND',
  );
  const pv = await svc.get(PT, d2.id);
  check(
    'the patient view hides staff history and correction requests',
    pv.events.length === 0 && pv.correctionRequests.length === 0,
  );
  check(
    "hospital B cannot see hospital A's invoice (404 NOT_FOUND)",
    (await code(svcB.get(RC_B, d2.id))) === 'NOT_FOUND',
  );

  // 12. Lab cancellation removes the draft charge.
  await inTx((tx) =>
    svc.charge(tx, DR, {
      kind: 'LAB',
      appointmentId: V2,
      labOrderItemId: LAB2,
      description: 'Complete blood count',
    }),
  );
  const d4 = (await svc.list(RC, { page: 1, limit: 20, status: 'DRAFT' })).items[0]!;
  await inTx((tx) => svc.releaseLabCharges(tx, DR, [LAB2]));
  const d4v = await svc.get(RC, d4.id);
  check(
    'cancelling the lab test removes its charge from the draft',
    d4v.lines.length === 0 &&
      d4v.total === '0.00' &&
      d4v.finaliseBlockers.includes('EMPTY_INVOICE'),
  );
  check(
    'an empty draft cannot be finalised',
    (await code(svc.finalise(RC, d4.id))) === 'EMPTY_INVOICE',
  );

  console.log(`\n${pass}/${pass + fail} service checks passed`);
  await base.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('HARNESS ERROR:', e?.response ?? e);
  await base.$disconnect();
  process.exit(1);
});
