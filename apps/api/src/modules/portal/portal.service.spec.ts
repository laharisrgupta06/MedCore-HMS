import { Prisma } from '@prisma/client';
import { PortalService } from './portal.service';

/** Phase 10 patient isolation: every summary figure is filtered by the caller's own patient profile. */
describe('PortalService.summary', () => {
  const calls: { model: string; op: string; where: unknown }[] = [];
  const delegate = (model: string, rows: Record<string, unknown[]> = {}) =>
    new Proxy(
      {},
      {
        get:
          (_t, op: string) =>
          (args: { where?: unknown } = {}) => {
            calls.push({ model, op, where: args.where });
            if (op === 'count') return Promise.resolve(1);
            if (op === 'findFirst')
              return Promise.resolve(model === 'patient' ? { id: 'p-own' } : null);
            return Promise.resolve(rows[op] ?? []);
          },
      },
    );
  const client = {
    patient: delegate('patient'),
    appointment: delegate('appointment'),
    prescription: delegate('prescription'),
    labOrder: delegate('labOrder'),
    invoice: delegate('invoice', { findMany: [{ id: 'i1', total: new Prisma.Decimal('500.00') }] }),
    payment: delegate('payment', { findMany: [{ amount: new Prisma.Decimal('200.00') }] }),
    notification: delegate('notification'),
  };
  const svc = new PortalService({ client } as never);
  const actor = { userId: 'u-own', role: 'PATIENT', hospitalId: 'h1', sessionId: 's' } as const;

  it('resolves the patient from the session and scopes every query to it', async () => {
    const s = await svc.summary(actor as never);
    expect(calls[0]).toMatchObject({
      model: 'patient',
      where: { userId: 'u-own', deletedAt: null },
    });
    const json = (w: unknown) => JSON.stringify(w);
    for (const c of calls.slice(1)) {
      if (c.model === 'notification') expect(c.where).toMatchObject({ recipientId: 'u-own' });
      else expect(json(c.where)).toContain('"patientId":"p-own"');
    }
    expect(s.billing).toEqual({ openInvoices: 1, outstanding: '300.00' });
  });

  it('refuses a user without a patient profile with not found', async () => {
    const none = { ...client, patient: { findFirst: () => Promise.resolve(null) } };
    await expect(
      new PortalService({ client: none } as never).summary(actor as never),
    ).rejects.toMatchObject({ status: 404 });
  });
});
