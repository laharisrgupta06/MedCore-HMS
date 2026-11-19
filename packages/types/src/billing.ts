/**
 * Billing arithmetic shared by the API and the web app (Phase 8, task 8-B1). All money is held as
 * integer paise (bigint), so no floating point is ever involved. Rules:
 *   DEC-051 line arithmetic, discount allocation, invoice totals
 *   DEC-047 only a REGULAR registration in force collects GST
 *   DEC-049 statutory room rule
 *   DEC-052 document numbers
 *   DEC-048 GSTIN validation (mirror of the database function medcore_gstin_valid)
 * The database re-checks every stored result (M-11b); these helpers exist so screens can show the
 * same numbers before saving and so the API computes them once.
 */

export type GstRegistrationType = 'REGULAR' | 'COMPOSITION' | 'UNREGISTERED';
export type TaxTreatment = 'EXEMPT' | 'NIL_RATED' | 'TAXABLE';
export type TaxSupplyType = 'GOODS' | 'SERVICE';
export type CriticalCareUnit = 'ICU' | 'CCU' | 'ICCU' | 'NICU';
/** Why a taxable line carries no tax (DEC-047). */
export type TaxNotCollectedReason = 'UNREGISTERED' | 'COMPOSITION';

const MONEY = /^(\d{1,10})(?:\.(\d{1,2}))?$/;
const RATE = /^(\d{1,2})(?:\.(\d{1,2}))?$/;

/** "1234.5" → 123450n. Refuses negatives, more than two decimals and anything not a plain number. */
export function toPaise(amount: string): bigint {
  const m = MONEY.exec(amount.trim());
  if (!m) throw new Error(`Not a money amount: "${amount}"`);
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? '0').padEnd(2, '0'));
}

/** 123450n → "1234.50". */
export function formatPaise(paise: bigint): string {
  const neg = paise < 0n;
  const v = neg ? -paise : paise;
  return `${neg ? '-' : ''}${v / 100n}.${String(v % 100n).padStart(2, '0')}`;
}

/** "18" or "2.5" → basis points of a percent (1800n, 250n); 0 to 40 with at most two decimals. */
export function rateToBasisPoints(ratePercent: string): bigint {
  const m = RATE.exec(ratePercent.trim());
  if (!m) throw new Error(`Not a tax rate: "${ratePercent}"`);
  const bp = BigInt(m[1]!) * 100n + BigInt((m[2] ?? '0').padEnd(2, '0'));
  if (bp > 4000n) throw new Error('A tax rate cannot exceed 40%.');
  return bp;
}

/** Round half up of n / d for n ≥ 0, d > 0. */
export function divHalfUp(n: bigint, d: bigint): bigint {
  if (n < 0n || d <= 0n) throw new Error('divHalfUp expects n >= 0 and d > 0');
  return (n * 2n + d) / (2n * d);
}

export interface LineTaxInput {
  quantity: number;
  unitPricePaise: bigint;
  /** This line's share of the invoice discount (allocateDiscount). */
  discountSharePaise: bigint;
  treatment: TaxTreatment;
  ratePercent: string;
  priceIncludesTax: boolean;
  /** True only when a REGULAR registration is in force on the service date (taxCollection). */
  collectTax: boolean;
}

export interface LineTaxResult {
  grossPaise: bigint;
  netPaise: bigint;
  taxablePaise: bigint;
  taxPaise: bigint;
  totalPaise: bigint;
}

/** DEC-051 line arithmetic, one half-up rounding per step. */
export function lineTax(i: LineTaxInput): LineTaxResult {
  if (!Number.isInteger(i.quantity) || i.quantity < 1)
    throw new Error('Quantity must be a whole number of at least 1.');
  if (i.unitPricePaise < 0n) throw new Error('A price cannot be negative.');
  const grossPaise = BigInt(i.quantity) * i.unitPricePaise;
  if (i.discountSharePaise < 0n || i.discountSharePaise > grossPaise)
    throw new Error('A discount share must be between zero and the line amount.');
  const netPaise = grossPaise - i.discountSharePaise;
  const bp = i.treatment === 'TAXABLE' ? rateToBasisPoints(i.ratePercent) : 0n;
  if (!i.collectTax || bp === 0n) {
    return { grossPaise, netPaise, taxablePaise: netPaise, taxPaise: 0n, totalPaise: netPaise };
  }
  if (i.priceIncludesTax) {
    const taxablePaise = divHalfUp(netPaise * 10000n, 10000n + bp);
    return {
      grossPaise,
      netPaise,
      taxablePaise,
      taxPaise: netPaise - taxablePaise,
      totalPaise: netPaise,
    };
  }
  const taxPaise = divHalfUp(netPaise * bp, 10000n);
  return {
    grossPaise,
    netPaise,
    taxablePaise: netPaise,
    taxPaise,
    totalPaise: netPaise + taxPaise,
  };
}

/**
 * DEC-051 discount allocation: shares in proportion to gross (rounded down), the remainder to the
 * largest line (earliest on ties). The shares always add up to the discount exactly.
 */
export function allocateDiscount(grossPaise: readonly bigint[], discountPaise: bigint): bigint[] {
  const total = grossPaise.reduce((a, b) => a + b, 0n);
  if (discountPaise < 0n) throw new Error('A discount cannot be negative.');
  if (discountPaise > total) throw new Error('A discount cannot exceed the invoice amount.');
  if (discountPaise === 0n || total === 0n) return grossPaise.map(() => 0n);
  const shares = grossPaise.map((g) => (discountPaise * g) / total);
  let largest = 0;
  grossPaise.forEach((g, i) => {
    if (g > grossPaise[largest]!) largest = i;
  });
  shares[largest] = shares[largest]! + discountPaise - shares.reduce((a, b) => a + b, 0n);
  return shares;
}

export interface InvoiceTotals {
  subtotalPaise: bigint;
  taxPaise: bigint;
  discountPaise: bigint;
  totalPaise: bigint;
}

/** DEC-051 invoice totals: subtotal = Σ taxable, tax = Σ tax, total = subtotal + tax. */
export function invoiceTotals(
  lines: readonly (LineTaxResult & { discountSharePaise: bigint })[],
): InvoiceTotals {
  const sum = (f: (l: (typeof lines)[number]) => bigint) => lines.reduce((a, l) => a + f(l), 0n);
  const subtotalPaise = sum((l) => l.taxablePaise);
  const taxPaise = sum((l) => l.taxPaise);
  return {
    subtotalPaise,
    taxPaise,
    discountPaise: sum((l) => l.discountSharePaise),
    totalPaise: subtotalPaise + taxPaise,
  };
}

/** DEC-047: tax is collected only under a REGULAR registration; otherwise the reason is recorded. */
export function taxCollection(registration: GstRegistrationType | null): {
  collect: boolean;
  reason: TaxNotCollectedReason | null;
} {
  if (registration === 'REGULAR') return { collect: true, reason: null };
  return {
    collect: false,
    reason: registration === 'COMPOSITION' ? 'COMPOSITION' : 'UNREGISTERED',
  };
}

export interface RoomRule {
  thresholdPerDayPaise: bigint;
  ratePercent: string;
  sacCode: string;
  priceIncludesTax: boolean;
}

/**
 * DEC-049: a room charge per day per patient, before discount, above the threshold is TAXABLE at the
 * rule's rate on the whole charge; exactly the threshold or less, or an ICU-type or critical-care room,
 * is EXEMPT.
 */
export function roomTreatment(
  perDayChargePaise: bigint,
  criticalCare: boolean,
  rule: RoomRule,
): { treatment: TaxTreatment; ratePercent: string } {
  if (criticalCare || perDayChargePaise <= rule.thresholdPerDayPaise)
    return { treatment: 'EXEMPT', ratePercent: '0' };
  return { treatment: 'TAXABLE', ratePercent: rule.ratePercent };
}

/** Indian financial year (1 April to 31 March) of a local date "YYYY-MM-DD", as "26-27". */
export function financialYearLabel(localDate: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(localDate);
  if (!m) throw new Error('Expected a date as YYYY-MM-DD.');
  const year = Number(m[1]);
  const start = Number(m[2]) >= 4 ? year : year - 1;
  return `${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export const DOCUMENT_PREFIX = /^[A-Z0-9]{1,4}$/;
export const MAX_SERIAL_PER_YEAR = 99_999;

/** DEC-052 document number "PREFIX/YY-YY/NNNNN", at most 16 characters (Rule 46(b)). */
export function documentNumber(prefix: string, financialYear: string, serial: number): string {
  if (!DOCUMENT_PREFIX.test(prefix)) throw new Error('A prefix is 1 to 4 characters, A–Z and 0–9.');
  if (!/^\d{2}-\d{2}$/.test(financialYear))
    throw new Error('A financial year is written as YY-YY.');
  if (!Number.isInteger(serial) || serial < 1 || serial > MAX_SERIAL_PER_YEAR)
    throw new Error('SERIES_EXHAUSTED');
  return `${prefix}/${financialYear}/${String(serial).padStart(5, '0')}`;
}

const GSTIN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{3}[ABCFGHJLPT][A-Z][0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** DEC-048 revision 2: the same rules as the database function medcore_gstin_valid. */
export function isValidGstin(gstin: string): boolean {
  if (!GSTIN_PATTERN.test(gstin) || gstin.slice(7, 11) === '0000') return false;
  const state = Number(gstin.slice(0, 2));
  if (state < 1 || state > 38) return false;
  let s = 0;
  for (let i = 0; i < 14; i++) {
    const p = GSTIN_ALPHABET.indexOf(gstin[i]!) * (i % 2 === 0 ? 1 : 2);
    s += Math.floor(p / 36) + (p % 36);
  }
  return GSTIN_ALPHABET[(36 - (s % 36)) % 36] === gstin[14];
}
