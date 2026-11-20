import type { DocumentType, InvoiceStatus, InvoiceView } from '@medcore/types';

export const rupees = (v: string) =>
  `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: 'Draft',
  FINALISED: 'Issued',
  PARTIALLY_PAID: 'Partly paid',
  PAID: 'Paid',
  VOID: 'Void',
};
export const STATUS_TONE: Record<
  InvoiceStatus,
  'neutral' | 'info' | 'warning' | 'success' | 'error'
> = {
  DRAFT: 'warning',
  FINALISED: 'info',
  PARTIALLY_PAID: 'info',
  PAID: 'success',
  VOID: 'neutral',
};
export const DOCUMENT_LABEL: Record<DocumentType, string> = {
  TAX_INVOICE: 'Tax invoice',
  INVOICE_CUM_BILL_OF_SUPPLY: 'Invoice-cum-bill of supply',
  BILL_OF_SUPPLY: 'Bill of supply',
};

/** "BOS/26-27/00001", or "Draft" with no statutory number (DEC-052). */
export const documentTitle = (i: Pick<InvoiceView, 'invoiceNumber' | 'status' | 'kind'>) =>
  i.invoiceNumber ??
  (i.status === 'VOID' ? 'Void draft' : i.kind === 'LATE_CHARGES' ? 'Late-charge draft' : 'Draft');

export const BLOCKER_TEXT: Record<string, string> = {
  TAX_SETUP_UNCONFIRMED: 'The hospital admin has not confirmed the tax set-up yet.',
  EMPTY_INVOICE: 'Add at least one charge.',
  UNCLASSIFIED_LINES:
    'Some charges have no tax classification. Classify them in tax settings, then re-resolve.',
  NOTHING_TO_PAY: 'The total is zero.',
  LINE_AFTER_ISSUE_DATE: 'A charge is dated after today.',
};

export function treatmentText(l: {
  unclassified: boolean;
  treatment: string | null;
  ratePercent: string | null;
  priceIncludesTax: boolean | null;
  gstCollected: boolean;
  notCollectedReason: string | null;
}) {
  if (l.unclassified) return 'Not classified';
  if (l.treatment === 'EXEMPT') return 'Exempt';
  if (l.treatment === 'NIL_RATED') return 'Nil rated';
  const r = `${Number(l.ratePercent)}% GST${l.priceIncludesTax ? ' incl.' : ''}`;
  if (!l.gstCollected)
    return `${r} (not collected: ${l.notCollectedReason === 'COMPOSITION' ? 'composition' : 'unregistered'})`;
  return r;
}
