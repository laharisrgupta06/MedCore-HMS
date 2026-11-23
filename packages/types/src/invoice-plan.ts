import { allocateDiscount, formatPaise, toPaise } from './billing';
import type { LineSnapshot } from './invoice-snapshot';

/**
 * Invoice-level arithmetic for the billing service (task 8-B3), in the same terms the M-11b triggers
 * check: totals equal the sum of the lines (subtotal = Σ taxable, tax = Σ tax, discount = Σ shares,
 * total = subtotal + tax; DEC-051) and the accountant's discount is shared by allocateDiscount.
 */
export type InvoiceTotalsView = {
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  total: string;
};

type Amounts = Pick<LineSnapshot, 'taxableValue' | 'taxAmount' | 'discountShare'>;

export function totalsOf(lines: readonly Amounts[]): InvoiceTotalsView {
  let sub = 0n,
    tax = 0n,
    disc = 0n;
  for (const l of lines) {
    sub += toPaise(l.taxableValue);
    tax += toPaise(l.taxAmount);
    disc += toPaise(l.discountShare);
  }
  return {
    subtotal: formatPaise(sub),
    taxAmount: formatPaise(tax),
    discountAmount: formatPaise(disc),
    total: formatPaise(sub + tax),
  };
}

/** Discount shares for the given line gross amounts, in line order (strings, rupees). */
export function discountShares(grossAmounts: readonly string[], discount: string): string[] {
  return allocateDiscount(grossAmounts.map(toPaise), toPaise(discount)).map(formatPaise);
}

/**
 * Why an invoice cannot be finalised yet, in the order the database checks (M-11b finalise rules).
 * The database is the authority; this lets the screen explain the reason before the user tries.
 */
export type FinaliseBlocker =
  | 'TAX_SETUP_UNCONFIRMED'
  | 'EMPTY_INVOICE'
  | 'UNCLASSIFIED_LINES'
  | 'NOTHING_TO_PAY'
  | 'LINE_AFTER_ISSUE_DATE';

export function finaliseBlockers(input: {
  taxSetupConfirmed: boolean;
  lines: readonly (Pick<
    LineSnapshot,
    'unclassified' | 'taxableValue' | 'taxAmount' | 'discountShare'
  > & { serviceDate: string })[];
  issueDate: string;
}): FinaliseBlocker[] {
  const out: FinaliseBlocker[] = [];
  if (!input.taxSetupConfirmed) out.push('TAX_SETUP_UNCONFIRMED');
  if (input.lines.length === 0) out.push('EMPTY_INVOICE');
  if (input.lines.some((l) => l.unclassified)) out.push('UNCLASSIFIED_LINES');
  if (input.lines.length > 0 && toPaise(totalsOf(input.lines).total) <= 0n)
    out.push('NOTHING_TO_PAY');
  if (input.lines.some((l) => l.serviceDate > input.issueDate)) out.push('LINE_AFTER_ISSUE_DATE');
  return out;
}

export const InvoiceErrorCode = {
  NOT_DRAFT: 'NOT_DRAFT',
  DOCUMENT_ISSUED: 'DOCUMENT_ISSUED',
  INVOICE_EXISTS: 'INVOICE_EXISTS',
  ALREADY_BILLED: 'ALREADY_BILLED',
  EMPTY_INVOICE: 'EMPTY_INVOICE',
  UNCLASSIFIED_LINES: 'UNCLASSIFIED_LINES',
  TAX_DEFAULTS_UNCONFIRMED: 'TAX_DEFAULTS_UNCONFIRMED',
  NOTHING_TO_PAY: 'NOTHING_TO_PAY',
  SERIES_EXHAUSTED: 'SERIES_EXHAUSTED',
  SNAPSHOT_STALE: 'SNAPSHOT_STALE',
} as const;
export type InvoiceErrorCode = (typeof InvoiceErrorCode)[keyof typeof InvoiceErrorCode];
