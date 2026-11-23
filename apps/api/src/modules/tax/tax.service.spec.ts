import { BadRequestException } from '@nestjs/common';
import { TaxService } from './tax.module';

/** Checks the tax service makes before touching the database (8-B2); the database rules are tested in test/. */
const actor = { userId: 'u1', role: 'HOSPITAL_ADMIN', hospitalId: 'h1', sessionId: 's1' } as never;

function make(tx: Record<string, unknown> = {}) {
  const $transaction = jest.fn(async (fn: (t: unknown) => unknown) =>
    fn({ $executeRaw: jest.fn(), ...tx }),
  );
  return { svc: new TaxService({ client: { $transaction } } as never), $transaction };
}

describe('TaxService input checks', () => {
  it('refuses an HSN code for a service and a SAC code for goods', async () => {
    const { svc, $transaction } = make();
    await expect(
      svc.createClassification(actor, { name: 'x', supplyType: 'SERVICE', hsnSac: '3004' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.createClassification(actor, { name: 'x', supplyType: 'GOODS', hsnSac: '9993' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect($transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['TAXABLE', '0'],
    ['TAXABLE', '41'],
    ['EXEMPT', '5'],
    ['NIL_RATED', '0.01'],
  ] as const)('refuses %s at %s%%', async (treatment, ratePercent) => {
    const { svc, $transaction } = make();
    await expect(
      svc.addVersion(actor, 'c1', {
        treatment,
        ratePercent,
        priceIncludesTax: false,
        effectiveFrom: '2027-01-01',
      }),
    ).rejects.toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'RATE_INVALID' }) }),
    );
    expect($transaction).not.toHaveBeenCalled();
  });

  it('refuses an invalid GSTIN before writing', async () => {
    const { svc, $transaction } = make();
    await expect(
      svc.addRegistration(actor, {
        registrationType: 'REGULAR',
        gstin: '27AAPFU0939F1ZX',
        legalName: 'L',
        effectiveFrom: '2027-01-01',
      }),
    ).rejects.toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'GSTIN_INVALID' }) }),
    );
    expect($transaction).not.toHaveBeenCalled();
  });

  it('locks the hospital row first in every write', async () => {
    const order: string[] = [];
    const tx = {
      $executeRaw: jest.fn(async () => order.push('lock hospital')),
      taxClassification: { create: jest.fn(async () => (order.push('create'), { id: 'c1' })) },
    };
    const $transaction = jest.fn(async (fn: (t: unknown) => unknown) => fn(tx));
    const svc = new TaxService({ client: { $transaction } } as never);
    await svc.createClassification(actor, {
      name: 'Consultation',
      supplyType: 'SERVICE',
      hsnSac: '999312',
    });
    expect(order).toEqual(['lock hospital', 'create']);
  });

  it('refuses to confirm the set-up until both defaults are chosen', async () => {
    const { svc } = make({
      hospitalTaxDefault: { findMany: async () => [{ kind: 'CONSULTATION' }] },
    });
    await expect(svc.confirm(actor)).rejects.toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'DEFAULTS_MISSING' }) }),
    );
  });

  it('refuses a classification the hospital does not own, before writing the default or assignment', async () => {
    const upsert = jest.fn();
    const update = jest.fn();
    const { svc } = make({
      taxClassification: { findFirst: async () => null },
      hospitalTaxDefault: { upsert },
      medicine: { findFirst: async () => ({ id: 'm1' }), update },
    });
    await expect(svc.setDefault(actor, 'LAB', { classificationId: 'x' })).rejects.toThrow(
      expect.objectContaining({ status: 404 }),
    );
    await expect(svc.assign(actor, 'medicines', 'm1', { classificationId: 'x' })).rejects.toThrow(
      expect.objectContaining({ status: 404 }),
    );
    expect(upsert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
