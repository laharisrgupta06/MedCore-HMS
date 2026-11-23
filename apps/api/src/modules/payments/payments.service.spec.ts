import { Prisma } from '@prisma/client';
import { PaymentsService } from './payments.service';

/**
 * Phase 13: billing and payment restrictions in PaymentsService, on an in-memory transaction. The
 * database rules (M-12) are tested separately on a scratch PostgreSQL database; these tests check the
 * application refuses first, under its own locks, and changes nothing when it refuses.
 */
type Pay = {
  id: string;
  invoiceId: string;
  hospitalId: string;
  method: string;
  status: string;
  amount: string;
  provider?: string;
  providerReference?: string;
  reconciled?: boolean;
};

function world(
  opts: {
    rules?: boolean;
    invoiceStatus?: string;
    total?: string;
    payments?: Pay[];
    seenEvent?: boolean;
  } = {},
) {
  const st = {
    rules: opts.rules ?? true,
    invoice: { id: 'i1', status: opts.invoiceStatus ?? 'FINALISED', total: opts.total ?? '500.00' },
    payments: [...(opts.payments ?? [])] as Pay[],
    executed: [] as string[],
    invoiceUpdates: [] as unknown[],
    audits: [] as { action: string; changes: Record<string, string> }[],
    webhookEvents: 0,
    created: [] as unknown[],
  };
  const sumPaid = (invoiceId: string) =>
    st.payments
      .filter((p) => p.invoiceId === invoiceId && p.status === 'SUCCEEDED')
      .reduce((s, p) => s.plus(p.amount), new Prisma.Decimal(0));
  const tx = {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      if (sql.includes('pg_trigger')) return Promise.resolve([{ n: st.rules ? 1 : 0 }]);
      if (sql.includes('FROM invoices'))
        return Promise.resolve([{ status: st.invoice.status, total: st.invoice.total }]);
      if (sql.includes('FROM payments')) {
        const p = st.payments.find((x) => x.id === values[0]);
        return Promise.resolve(
          p
            ? [
                {
                  status: p.status,
                  method: p.method,
                  amount: p.amount,
                  providerReference: p.providerReference ?? null,
                  reconciled: !!p.reconciled,
                },
              ]
            : [],
        );
      }
      return Promise.resolve([]);
    },
    $executeRaw: (strings: TemplateStringsArray) => (
      st.executed.push(strings.join('?')),
      Promise.resolve(1)
    ),
    payment: {
      findFirst: ({ where }: { where: Record<string, unknown> }) => {
        const m = st.payments.find((p) =>
          where.id
            ? p.id === where.id
            : where.providerReference
              ? p.providerReference === where.providerReference
              : p.invoiceId === where.invoiceId && p.status === 'PENDING' && p.method !== 'CASH',
        );
        return Promise.resolve(m ? { ...m, invoiceId: m.invoiceId } : null);
      },
      aggregate: ({ where }: { where: { invoiceId: string } }) =>
        Promise.resolve({ _sum: { amount: sumPaid(where.invoiceId) } }),
      create: ({ data }: { data: Record<string, unknown> }) => {
        st.created.push(data);
        const p = {
          id: `p${st.payments.length + 1}`,
          invoiceId: String(data.invoiceId),
          hospitalId: 'h1',
          method: String(data.method),
          status: String(data.status),
          amount: String(data.amount),
        };
        st.payments.push(p);
        return Promise.resolve({ id: p.id, amount: new Prisma.Decimal(p.amount) });
      },
      update: ({ where, data }: { where: { id: string }; data: { status?: string } }) => {
        const p = st.payments.find((x) => x.id === where.id)!;
        if (data.status) p.status = data.status;
        return Promise.resolve(p);
      },
    },
    invoice: {
      findUnique: () =>
        Promise.resolve({ status: st.invoice.status, patient: { userId: 'u-patient' } }),
      update: ({ data }: { data: { status: string } }) => (
        st.invoiceUpdates.push(data),
        (st.invoice.status = data.status),
        Promise.resolve({})
      ),
    },
    webhookEvent: {
      findUnique: () => Promise.resolve(opts.seenEvent ? { id: 'w' } : null),
      create: () => (st.webhookEvents++, Promise.resolve({})),
    },
    auditLog: {
      create: ({ data }: { data: { action: string; changes: Record<string, string> } }) => (
        st.audits.push(data),
        Promise.resolve({})
      ),
    },
  };
  const client = {
    ...tx,
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    invoice: {
      ...tx.invoice,
      findFirst: () =>
        Promise.resolve({
          id: 'i1',
          status: st.invoice.status,
          total: new Prisma.Decimal(st.invoice.total),
        }),
    },
    payment: { ...tx.payment, findMany: () => Promise.resolve([]) },
  };
  const notifications = {
    stage: jest.fn().mockResolvedValue([]),
    dispatch: jest.fn().mockResolvedValue(undefined),
  };
  const events = { publish: jest.fn().mockResolvedValue(undefined) };
  return { st, client, notifications, events };
}

const actor = (role = 'RECEPTIONIST') =>
  ({ userId: 'u-staff', role, hospitalId: 'h1', sessionId: 's' }) as never;
const make = (w: ReturnType<typeof world>, adapter: unknown = null) =>
  new PaymentsService(
    { client: w.client } as never,
    w.client as never,
    adapter as never,
    w.events as never,
    w.notifications as never,
  );
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'resolved',
    (e: { response?: { code?: string } }) => e.response?.code ?? String(e),
  );

describe('PaymentsService restrictions', () => {
  it('refuses every cash payment until M-12 is installed, and writes nothing', async () => {
    const w = world({ rules: false });
    expect(await code(make(w).recordCash(actor(), 'i1', '100.00'))).toBe('PAYMENT_RULES_PENDING');
    expect(w.st.created).toHaveLength(0);
    expect(w.st.invoiceUpdates).toHaveLength(0);
  });

  it.each(['DRAFT', 'PAID', 'VOID'])('refuses cash on a %s invoice', async (s) => {
    const w = world({ invoiceStatus: s });
    expect(await code(make(w).recordCash(actor(), 'i1', '100.00'))).toBe('NOT_PAYABLE');
    expect(w.st.created).toHaveLength(0);
  });

  it('refuses cash while an online checkout is open (DEC-064)', async () => {
    const w = world({
      payments: [
        {
          id: 'p1',
          invoiceId: 'i1',
          hospitalId: 'h1',
          method: 'STRIPE_CARD',
          status: 'PENDING',
          amount: '500.00',
        },
      ],
    });
    expect(await code(make(w).recordCash(actor(), 'i1', '100.00'))).toBe('CHECKOUT_OPEN');
  });

  it('refuses more than the balance', async () => {
    const w = world({
      payments: [
        {
          id: 'p1',
          invoiceId: 'i1',
          hospitalId: 'h1',
          method: 'CASH',
          status: 'SUCCEEDED',
          amount: '450.00',
        },
      ],
      invoiceStatus: 'PARTIALLY_PAID',
    });
    expect(await code(make(w).recordCash(actor(), 'i1', '60.00'))).toBe('AMOUNT_EXCEEDS_BALANCE');
  });

  it('refuses a zero amount', async () => {
    expect(await code(make(world()).recordCash(actor(), 'i1', '0.00'))).toBe('AMOUNT_INVALID');
  });

  it('records partial cash, marks the change as a payment change, moves the invoice and stages the notice in the same transaction', async () => {
    const w = world();
    await make(w).recordCash(actor(), 'i1', '200.00');
    expect(w.st.created[0]).toMatchObject({
      method: 'CASH',
      status: 'SUCCEEDED',
      receivedById: 'u-staff',
    });
    expect(w.st.executed.some((s) => s.includes("set_config('medcore.payment_change'"))).toBe(true);
    expect(w.st.invoiceUpdates).toEqual([{ status: 'PARTIALLY_PAID' }]);
    expect(w.notifications.stage).toHaveBeenCalledTimes(1);
    expect(w.notifications.dispatch).toHaveBeenCalledTimes(1);
  });

  it('refuses online checkout when no provider is configured, and for a method the provider does not take', async () => {
    expect(await code(make(world()).startCheckout(actor(), 'i1', 'STRIPE_CARD'))).toBe(
      'PROVIDER_NOT_CONFIGURED',
    );
    const razorpayOnly = { supports: (m: string) => m !== 'STRIPE_CARD' };
    expect(
      await code(make(world(), razorpayOnly).startCheckout(actor(), 'i1', 'STRIPE_CARD')),
    ).toBe('PROVIDER_NOT_CONFIGURED');
  });

  it('never reverses a reconciled payment, or one that was not received', async () => {
    const rec = world({
      payments: [
        {
          id: 'p1',
          invoiceId: 'i1',
          hospitalId: 'h1',
          method: 'CASH',
          status: 'SUCCEEDED',
          amount: '100.00',
          reconciled: true,
        },
      ],
    });
    expect(await code(make(rec).reversePayment(actor('ACCOUNTANT'), 'p1', 'Entered twice'))).toBe(
      'RECONCILED_PAYMENT',
    );
    const failed = world({
      payments: [
        {
          id: 'p1',
          invoiceId: 'i1',
          hospitalId: 'h1',
          method: 'STRIPE_CARD',
          status: 'FAILED',
          amount: '100.00',
        },
      ],
    });
    expect(
      await code(make(failed).reversePayment(actor('ACCOUNTANT'), 'p1', 'Entered twice')),
    ).toBe('NOT_REVERSIBLE');
    expect(rec.st.executed.concat(failed.st.executed).some((s) => s.includes('REVERSED'))).toBe(
      false,
    );
  });
});

describe('PaymentsService webhooks', () => {
  const adapter = (outcome: 'SUCCEEDED' | 'FAILED', amount: string | null = '500.00') => ({
    supports: () => true,
    verifyWebhook: () => ({
      provider: 'STRIPE',
      eventId: 'evt_1',
      providerReference: 'cs_1',
      outcome,
      amount,
    }),
  });
  const open = (status = 'PENDING'): Pay => ({
    id: 'p1',
    invoiceId: 'i1',
    hospitalId: 'h1',
    method: 'STRIPE_CARD',
    status,
    amount: '500.00',
    provider: 'STRIPE',
    providerReference: 'cs_1',
  });
  const hook = (svc: PaymentsService) =>
    svc.receiveWebhook('stripe', { rawBody: Buffer.from('{}'), headers: {} });

  it('applies a verified success once: payment received, invoice PAID, event recorded', async () => {
    const w = world({ payments: [open()] });
    await hook(make(w, adapter('SUCCEEDED')));
    expect(w.st.payments[0]!.status).toBe('SUCCEEDED');
    expect(w.st.invoiceUpdates).toEqual([{ status: 'PAID' }]);
    expect(w.st.webhookEvents).toBe(1);
  });

  it('ignores a replayed event', async () => {
    const w = world({ payments: [open()], seenEvent: true });
    await hook(make(w, adapter('SUCCEEDED')));
    expect(w.st.payments[0]!.status).toBe('PENDING');
    expect(w.st.webhookEvents).toBe(0);
  });

  it('holds a success for a cancelled checkout instead of applying it (DEC-064)', async () => {
    const w = world({ payments: [open('FAILED')] });
    await hook(make(w, adapter('SUCCEEDED')));
    expect(w.st.payments[0]!.status).toBe('FAILED');
    expect(w.st.audits.map((a) => a.action)).toContain('payment.webhook.held');
    expect(w.st.invoiceUpdates).toHaveLength(0);
  });

  it('holds a success whose amount differs from the payment record', async () => {
    const w = world({ payments: [open()] });
    await hook(make(w, adapter('SUCCEEDED', '1.00')));
    expect(w.st.payments[0]!.status).toBe('PENDING');
    expect(w.st.audits[0]?.changes.reason).toMatch(/amount differs/);
  });

  it('refuses a webhook sent to the wrong provider route', async () => {
    const w = world({ payments: [open()] });
    expect(
      await code(
        make(w, adapter('SUCCEEDED')).receiveWebhook('razorpay', {
          rawBody: Buffer.from('{}'),
          headers: {},
        }),
      ),
    ).toBe('WEBHOOK_INVALID');
  });
});
