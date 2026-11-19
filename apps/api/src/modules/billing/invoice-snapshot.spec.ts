import {
  allocateDiscount,
  documentTypeFor,
  formatPaise,
  lineSnapshot,
  LineSnapshotError,
  toPaise,
  type ClassificationData,
  type RegistrationData,
  type RoomRuleData,
} from '@medcore/types';

/**
 * T-BILL-SNAP-001: the shared snapshot builder gives exactly the values the M-11b line trigger
 * accepted in the PostgreSQL behaviour tests (proposal validation/behaviour_tests.py).
 */
const SVC: ClassificationData = {
  id: 'c-svc',
  name: 'Healthcare services',
  hsnSac: '999312',
  supplyType: 'SERVICE',
  isActive: true,
  versions: [
    {
      id: 'v-svc',
      effectiveFrom: '2026-04-01',
      treatment: 'EXEMPT',
      ratePercent: '0.00',
      priceIncludesTax: false,
    },
  ],
};
const MED: ClassificationData = {
  id: 'c-med',
  name: 'Medicaments',
  hsnSac: '3004',
  supplyType: 'GOODS',
  isActive: true,
  versions: [
    {
      id: 'v-med12',
      effectiveFrom: '2026-04-01',
      treatment: 'TAXABLE',
      ratePercent: '12.00',
      priceIncludesTax: true,
    },
    {
      id: 'v-med5',
      effectiveFrom: '2026-09-22',
      treatment: 'TAXABLE',
      ratePercent: '5.00',
      priceIncludesTax: true,
    },
  ],
};
const TAXSVC: ClassificationData = {
  id: 'c-tax',
  name: 'Taxable service',
  hsnSac: '998599',
  supplyType: 'SERVICE',
  isActive: true,
  versions: [
    {
      id: 'v-tax',
      effectiveFrom: '2026-04-01',
      treatment: 'TAXABLE',
      ratePercent: '18.00',
      priceIncludesTax: false,
    },
  ],
};
const REGULAR: RegistrationData[] = [{ effectiveFrom: '2026-04-01', registrationType: 'REGULAR' }];
const RULES: RoomRuleData[] = [
  {
    id: 'rule',
    effectiveFrom: '2022-07-18',
    thresholdPerDay: '5000.00',
    ratePercent: '5.00',
    sacCode: '9993',
    priceIncludesTax: false,
  },
];
const D = '2026-11-18';

describe('line snapshots (DEC-051, matches the M-11b trigger)', () => {
  it('consultation: exempt, collected by a regular hospital', () => {
    expect(
      lineSnapshot({
        kind: 'CONSULTATION',
        quantity: 1,
        unitPrice: '500',
        serviceDate: D,
        classification: SVC,
        registrations: REGULAR,
      }),
    ).toMatchObject({
      unclassified: false,
      classificationVersionId: 'v-svc',
      treatment: 'EXEMPT',
      ratePercent: '0.00',
      gstCollected: true,
      notCollectedReason: null,
      grossAmount: '500.00',
      taxableValue: '500.00',
      taxAmount: '0.00',
      lineTotal: '500.00',
    });
  });

  it('pharmacy: 5% version in force from 22 September, MRP includes tax', () => {
    expect(
      lineSnapshot({
        kind: 'PHARMACY',
        quantity: 10,
        unitPrice: '12',
        serviceDate: D,
        classification: MED,
        registrations: REGULAR,
      }),
    ).toMatchObject({
      classificationVersionId: 'v-med5',
      ratePercent: '5.00',
      taxableValue: '114.29',
      taxAmount: '5.71',
      lineTotal: '120.00',
    });
  });

  it('a charge dated the day before the rate change keeps the old 12%', () => {
    expect(
      lineSnapshot({
        kind: 'PHARMACY',
        quantity: 10,
        unitPrice: '12',
        serviceDate: '2026-09-21',
        classification: MED,
        registrations: REGULAR,
      }),
    ).toMatchObject({
      classificationVersionId: 'v-med12',
      taxableValue: '107.14',
      taxAmount: '12.86',
    });
  });

  it('other charge, 18% added on top', () => {
    expect(
      lineSnapshot({
        kind: 'OTHER',
        quantity: 1,
        unitPrice: '100',
        serviceDate: D,
        classification: TAXSVC,
        registrations: REGULAR,
      }),
    ).toMatchObject({ taxableValue: '100.00', taxAmount: '18.00', lineTotal: '118.00' });
  });

  it('unclassified, inactive or not yet in force: automatic lines are unclassified, never refused', () => {
    const none = lineSnapshot({
      kind: 'PHARMACY',
      quantity: 1,
      unitPrice: '90',
      serviceDate: D,
      classification: null,
      registrations: REGULAR,
    });
    expect(none).toMatchObject({
      unclassified: true,
      classificationId: null,
      gstCollected: false,
      notCollectedReason: null,
      taxableValue: '90.00',
      taxAmount: '0.00',
      lineTotal: '90.00',
    });
    expect(
      lineSnapshot({
        kind: 'PHARMACY',
        quantity: 1,
        unitPrice: '90',
        serviceDate: D,
        classification: { ...MED, isActive: false },
        registrations: REGULAR,
      }).unclassified,
    ).toBe(true);
    expect(
      lineSnapshot({
        kind: 'LAB',
        quantity: 1,
        unitPrice: '350',
        serviceDate: '2026-03-31',
        classification: SVC,
        registrations: REGULAR,
      }).unclassified,
    ).toBe(true);
  });

  it('other charges need a usable classification', () => {
    expect(() =>
      lineSnapshot({
        kind: 'OTHER',
        quantity: 1,
        unitPrice: '100',
        serviceDate: D,
        classification: { ...TAXSVC, isActive: false },
        registrations: REGULAR,
      }),
    ).toThrow(LineSnapshotError);
  });

  it('unregistered and composition hospitals collect nothing; the supply stays taxable', () => {
    const u = lineSnapshot({
      kind: 'PHARMACY',
      quantity: 10,
      unitPrice: '12',
      serviceDate: D,
      classification: MED,
      registrations: [],
    });
    expect(u).toMatchObject({
      treatment: 'TAXABLE',
      ratePercent: '5.00',
      gstCollected: false,
      notCollectedReason: 'UNREGISTERED',
      taxableValue: '120.00',
      taxAmount: '0.00',
    });
    const c = lineSnapshot({
      kind: 'PHARMACY',
      quantity: 10,
      unitPrice: '12',
      serviceDate: D,
      classification: MED,
      registrations: [...REGULAR, { effectiveFrom: '2026-11-01', registrationType: 'COMPOSITION' }],
    });
    expect(c.notCollectedReason).toBe('COMPOSITION');
    // A registration taking effect tomorrow does not affect today's line.
    expect(
      lineSnapshot({
        kind: 'PHARMACY',
        quantity: 10,
        unitPrice: '12',
        serviceDate: D,
        classification: MED,
        registrations: [
          ...REGULAR,
          { effectiveFrom: '2026-11-19', registrationType: 'COMPOSITION' },
        ],
      }).gstCollected,
    ).toBe(true);
  });

  it('rooms (DEC-049): above 5,000 taxed on the whole charge; 5,000, ICU and NICU exempt', () => {
    const room = (
      dailyCharge: string,
      type = 'PRIVATE',
      criticalCareUnit: 'NICU' | null = null,
      quantity = 2,
    ) =>
      lineSnapshot({
        kind: 'ROOM',
        quantity,
        unitPrice: dailyCharge,
        serviceDate: D,
        classification: null,
        registrations: REGULAR,
        room: { dailyCharge, type, criticalCareUnit },
        roomRules: RULES,
      });
    expect(room('6000')).toMatchObject({
      treatment: 'TAXABLE',
      ratePercent: '5.00',
      hsnSac: '9993',
      classificationName: 'Room accommodation',
      roomRuleId: 'rule',
      roomDailyCharge: '6000.00',
      roomCriticalCare: false,
      taxableValue: '12000.00',
      taxAmount: '600.00',
    });
    expect(room('5000')).toMatchObject({
      treatment: 'EXEMPT',
      ratePercent: '0.00',
      priceIncludesTax: false,
      taxAmount: '0.00',
    });
    expect(room('5000.01', 'PRIVATE', null, 1)).toMatchObject({
      treatment: 'TAXABLE',
      taxAmount: '250.00',
    });
    expect(room('8000', 'ICU')).toMatchObject({ treatment: 'EXEMPT', roomCriticalCare: true });
    expect(room('9000', 'OTHER', 'NICU')).toMatchObject({
      treatment: 'EXEMPT',
      roomCriticalCare: true,
    });
    expect(() =>
      lineSnapshot({
        kind: 'ROOM',
        quantity: 1,
        unitPrice: '1',
        serviceDate: D,
        classification: null,
        registrations: REGULAR,
        room: { dailyCharge: null, type: 'OTHER', criticalCareUnit: null },
        roomRules: RULES,
      }),
    ).toThrow(/no daily charge/);
    expect(() =>
      lineSnapshot({
        kind: 'ROOM',
        quantity: 1,
        unitPrice: '6000',
        serviceDate: '2022-07-17',
        classification: null,
        registrations: REGULAR,
        room: { dailyCharge: '6000', type: 'WARD', criticalCareUnit: null },
        roomRules: RULES,
      }),
    ).toThrow(/No statutory room rule/);
  });

  it("the plan's worked example to the paisa: discount 62 on 500 exempt + 120 at 5% included", () => {
    const shares = allocateDiscount([toPaise('500'), toPaise('120')], toPaise('62')).map(
      formatPaise,
    );
    expect(shares).toEqual(['50.00', '12.00']);
    const a = lineSnapshot({
      kind: 'CONSULTATION',
      quantity: 1,
      unitPrice: '500',
      serviceDate: D,
      discountShare: shares[0],
      classification: SVC,
      registrations: REGULAR,
    });
    const b = lineSnapshot({
      kind: 'PHARMACY',
      quantity: 10,
      unitPrice: '12',
      serviceDate: D,
      discountShare: shares[1],
      classification: MED,
      registrations: REGULAR,
    });
    expect([a.taxableValue, a.taxAmount, b.taxableValue, b.taxAmount]).toEqual([
      '450.00',
      '0.00',
      '102.86',
      '5.14',
    ]);
    expect(documentTypeFor('REGULAR', [a, b])).toBe('INVOICE_CUM_BILL_OF_SUPPLY');
    // Unregistered: the tablets keep 5% for reference, collect nothing, and the document is a bill of supply.
    const u = lineSnapshot({
      kind: 'PHARMACY',
      quantity: 10,
      unitPrice: '12',
      serviceDate: D,
      discountShare: shares[1],
      classification: MED,
      registrations: [],
    });
    expect([u.taxableValue, u.taxAmount, u.ratePercent]).toEqual(['108.00', '0.00', '5.00']);
    expect(documentTypeFor('UNREGISTERED', [a, u])).toBe('BILL_OF_SUPPLY');
  });

  it('document types (DEC-047)', () => {
    const taxed = { gstCollected: true, treatment: 'TAXABLE' as const };
    const exempt = { gstCollected: true, treatment: 'EXEMPT' as const };
    expect(documentTypeFor('REGULAR', [taxed])).toBe('TAX_INVOICE');
    expect(documentTypeFor('REGULAR', [taxed, exempt])).toBe('INVOICE_CUM_BILL_OF_SUPPLY');
    expect(documentTypeFor('REGULAR', [exempt])).toBe('BILL_OF_SUPPLY');
    expect(documentTypeFor('COMPOSITION', [{ gstCollected: false, treatment: 'TAXABLE' }])).toBe(
      'BILL_OF_SUPPLY',
    );
    expect(documentTypeFor(null, [exempt])).toBe('BILL_OF_SUPPLY');
  });
});

describe('discount allocation (plan section 6: half-up shares, signed remainder)', () => {
  it('a negative remainder goes to the largest line', () => {
    // 3 paise over three equal 1-rupee lines: 1 each (1.0), remainder 0; 2 paise: 0.67 -> 1 each, remainder -1.
    expect(allocateDiscount([100n, 100n, 100n], 2n)).toEqual([0n, 1n, 1n]);
  });
  it('lines with no amount get no share', () => {
    expect(allocateDiscount([0n, 1000n], 100n)).toEqual([0n, 100n]);
  });
  it('random invoices always share exactly, within each line', () => {
    let seed = 7;
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
    for (let k = 0; k < 2000; k++) {
      const gross = Array.from({ length: 1 + rnd(6) }, () => BigInt(rnd(500000)));
      const total = gross.reduce((a, b) => a + b, 0n);
      const d = total === 0n ? 0n : BigInt(rnd(Number(total) + 1));
      const s = allocateDiscount(gross, d);
      expect(s.reduce((a, b) => a + b, 0n)).toBe(d);
      s.forEach((sh, i) => expect(sh >= 0n && sh <= gross[i]!).toBe(true));
    }
  });
});
