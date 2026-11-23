import {
  allocateDiscount,
  divHalfUp,
  documentNumber,
  financialYearLabel,
  formatPaise,
  invoiceTotals,
  isValidGstin,
  lineTax,
  rateToBasisPoints,
  roomTreatment,
  taxCollection,
  toPaise,
} from '@medcore/types';

/** Shared billing arithmetic (8-B1): worked examples for DEC-047, DEC-049, DEC-051, DEC-052, DEC-048. */
describe('money parsing', () => {
  it('converts between rupee strings and paise exactly', () => {
    expect(toPaise('1234.5')).toBe(123450n);
    expect(toPaise('0.07')).toBe(7n);
    expect(toPaise('500')).toBe(50000n);
    expect(formatPaise(123450n)).toBe('1234.50');
    expect(formatPaise(7n)).toBe('0.07');
    for (const bad of ['-1', '1.234', 'abc', '1e3', '']) expect(() => toPaise(bad)).toThrow();
  });
  it('reads rates as basis points and refuses rates above 40%', () => {
    expect(rateToBasisPoints('18')).toBe(1800n);
    expect(rateToBasisPoints('2.5')).toBe(250n);
    expect(() => rateToBasisPoints('40.01')).toThrow(/40%/);
  });
  it('rounds half up', () => {
    expect(divHalfUp(5n, 2n)).toBe(3n);
    expect(divHalfUp(4n, 3n)).toBe(1n);
    expect(divHalfUp(5n, 3n)).toBe(2n);
  });
});

describe('DEC-051 line arithmetic', () => {
  const base = {
    quantity: 2,
    unitPricePaise: toPaise('100'),
    discountSharePaise: 0n,
    treatment: 'TAXABLE' as const,
    ratePercent: '12',
    priceIncludesTax: false,
    collectTax: true,
  };

  it('adds tax on top', () => {
    expect(lineTax(base)).toEqual({
      grossPaise: 20000n,
      netPaise: 20000n,
      taxablePaise: 20000n,
      taxPaise: 2400n,
      totalPaise: 22400n,
    });
  });
  it('takes tax out of a tax-inclusive price', () => {
    const r = lineTax({
      ...base,
      quantity: 1,
      unitPricePaise: toPaise('112'),
      priceIncludesTax: true,
    });
    expect(r).toEqual({
      grossPaise: 11200n,
      netPaise: 11200n,
      taxablePaise: 10000n,
      taxPaise: 1200n,
      totalPaise: 11200n,
    });
  });
  it('rounds the tax half up once', () => {
    expect(
      lineTax({ ...base, quantity: 1, unitPricePaise: 1005n, ratePercent: '5' }).taxPaise,
    ).toBe(50n); // 50.25
    expect(
      lineTax({ ...base, quantity: 1, unitPricePaise: 1010n, ratePercent: '5' }).taxPaise,
    ).toBe(51n); // 50.5
  });
  it('applies the discount share before tax', () => {
    const r = lineTax({ ...base, discountSharePaise: 2000n });
    expect(r.netPaise).toBe(18000n);
    expect(r.taxPaise).toBe(2160n);
    expect(r.totalPaise).toBe(20160n);
  });
  it('collects no tax without a regular registration, and none on exempt or nil-rated lines', () => {
    expect(lineTax({ ...base, collectTax: false })).toMatchObject({
      taxablePaise: 20000n,
      taxPaise: 0n,
      totalPaise: 20000n,
    });
    expect(lineTax({ ...base, treatment: 'EXEMPT', ratePercent: '0' }).taxPaise).toBe(0n);
    expect(lineTax({ ...base, treatment: 'NIL_RATED', ratePercent: '0' }).taxPaise).toBe(0n);
  });
  it('refuses a fractional quantity, a negative price and a share above the line', () => {
    expect(() => lineTax({ ...base, quantity: 1.5 })).toThrow();
    expect(() => lineTax({ ...base, unitPricePaise: -1n })).toThrow();
    expect(() => lineTax({ ...base, discountSharePaise: 20001n })).toThrow();
  });
});

describe('DEC-051 discount allocation and totals', () => {
  it('shares in proportion to gross, remainder to the largest line', () => {
    // 16.67 -> 17, 33.33 -> 33, 50.00 -> 50 (half-up); remainder 0.
    expect(allocateDiscount([100n, 200n, 300n], 100n)).toEqual([17n, 33n, 50n]);
  });
  it('gives the remainder to the earliest of equal largest lines', () => {
    // 1.5 -> 2 each (half-up), remainder -1 to the earliest largest line.
    expect(allocateDiscount([200n, 200n], 3n)).toEqual([1n, 2n]);
  });
  it('always adds up exactly, and refuses a discount above the total', () => {
    const gross = [12345n, 999n, 1n, 50000n, 7777n];
    for (const d of [0n, 1n, 17n, 9999n, 71122n]) {
      expect(allocateDiscount(gross, d).reduce((a, b) => a + b, 0n)).toBe(d);
    }
    expect(() => allocateDiscount([100n], 101n)).toThrow(/exceed/);
  });
  it('totals: subtotal = Σ taxable, total = subtotal + tax', () => {
    const shares = allocateDiscount([20000n, 50000n], 7000n);
    const lines = [
      {
        ...lineTax({
          quantity: 2,
          unitPricePaise: 10000n,
          discountSharePaise: shares[0]!,
          treatment: 'EXEMPT',
          ratePercent: '0',
          priceIncludesTax: false,
          collectTax: true,
        }),
        discountSharePaise: shares[0]!,
      },
      {
        ...lineTax({
          quantity: 1,
          unitPricePaise: 50000n,
          discountSharePaise: shares[1]!,
          treatment: 'TAXABLE',
          ratePercent: '12',
          priceIncludesTax: false,
          collectTax: true,
        }),
        discountSharePaise: shares[1]!,
      },
    ];
    expect(invoiceTotals(lines)).toEqual({
      subtotalPaise: 63000n,
      taxPaise: 5400n,
      discountPaise: 7000n,
      totalPaise: 68400n,
    });
  });
});

describe('DEC-047 collection and DEC-049 room rule', () => {
  it('collects only under a regular registration', () => {
    expect(taxCollection('REGULAR')).toEqual({ collect: true, reason: null });
    expect(taxCollection('COMPOSITION')).toEqual({ collect: false, reason: 'COMPOSITION' });
    expect(taxCollection(null)).toEqual({ collect: false, reason: 'UNREGISTERED' });
  });
  const rule = {
    thresholdPerDayPaise: toPaise('5000'),
    ratePercent: '5',
    sacCode: '9993',
    priceIncludesTax: false,
  };
  it('taxes a room only above the threshold and never critical care', () => {
    expect(roomTreatment(toPaise('5000'), false, rule)).toEqual({
      treatment: 'EXEMPT',
      ratePercent: '0',
    });
    expect(roomTreatment(toPaise('5000.01'), false, rule)).toEqual({
      treatment: 'TAXABLE',
      ratePercent: '5',
    });
    expect(roomTreatment(toPaise('9000'), true, rule).treatment).toBe('EXEMPT');
  });
});

describe('DEC-052 numbering', () => {
  it('labels the financial year from 1 April', () => {
    expect(financialYearLabel('2026-03-31')).toBe('25-26');
    expect(financialYearLabel('2026-04-01')).toBe('26-27');
    expect(financialYearLabel('2099-12-31')).toBe('99-00');
  });
  it('formats numbers within 16 characters and stops at 99,999', () => {
    expect(documentNumber('INV', '26-27', 1)).toBe('INV/26-27/00001');
    const longest = documentNumber('ABCD', '26-27', 99999);
    expect(longest).toBe('ABCD/26-27/99999');
    expect(longest.length).toBe(16);
    expect(() => documentNumber('INV', '26-27', 100000)).toThrow('SERIES_EXHAUSTED');
    expect(() => documentNumber('inv', '26-27', 1)).toThrow();
    expect(() => documentNumber('ABCDE', '26-27', 1)).toThrow();
  });
});

describe('DEC-048 GSTIN (same vectors as validation/gstin_reference.md)', () => {
  it.each([
    '37AAHAA4036G1ZY',
    '24AADCB2295A1Z7',
    '33AAACA5443N3ZN',
    '27AAPFU0939F1ZV',
    '38AAPFU0939F1ZS',
  ])('accepts %s', (g) => {
    expect(isValidGstin(g)).toBe(true);
  });
  it.each([
    ['27AAPFU0939F1ZO', 'check character'],
    ['27AAPFU0939F1AA', '14th character not Z'],
    ['27AAPKU0939F1ZK', 'holder type K'],
    ['07DELS71442A1DD', 'tax deductor'],
    ['37aahaa4036g1zy', 'lower case'],
    ['00AAPFU0939F1ZV', 'state 00'],
  ])('refuses %s (%s)', (g) => {
    expect(isValidGstin(g)).toBe(false);
  });
});
