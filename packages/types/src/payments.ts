import type { InvoiceStatus } from './invoices';

/**
 * Payment methods (DEC-054). Online methods go through a provider checkout; cash is recorded by staff;
 * a TPA settlement posts an insurer's payment on an approved claim to the balance (M-13).
 */
export const ONLINE_PAYMENT_METHODS = [
  'STRIPE_CARD',
  'RAZORPAY_UPI',
  'RAZORPAY_NETBANKING',
] as const;
export type OnlinePaymentMethod = (typeof ONLINE_PAYMENT_METHODS)[number];
export const PAYMENT_METHODS = [...ONLINE_PAYMENT_METHODS, 'CASH', 'TPA_SETTLEMENT'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** PENDING = checkout open; SUCCEEDED = received; FAILED = not received; REVERSED = taken back (M-12). */
export type PaymentState = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REVERSED';

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  STRIPE_CARD: 'Card',
  RAZORPAY_UPI: 'UPI',
  RAZORPAY_NETBANKING: 'Net banking',
  CASH: 'Cash',
  TPA_SETTLEMENT: 'Insurance settlement (TPA)',
};

export const PAYMENT_STATE_LABEL: Record<PaymentState, string> = {
  PENDING: 'Checkout open',
  SUCCEEDED: 'Received',
  FAILED: 'Not received',
  REVERSED: 'Reversed',
};

export const PAYMENT_ERROR_CODES = [
  'AMOUNT_INVALID',
  'NOT_PAYABLE',
  'NOTHING_TO_PAY',
  'CHECKOUT_OPEN',
  'AMOUNT_EXCEEDS_BALANCE',
  'PAYMENT_NOT_OPEN',
  'NOT_REVERSIBLE',
  'RECONCILED_PAYMENT',
  'RECEIPT_UNAVAILABLE',
  'RECEIPT_EMAIL_FAILED',
  'RANGE_INVALID',
  'PAYMENT_RULES_PENDING',
  'PROVIDER_NOT_CONFIGURED',
  'PROVIDER_UNAVAILABLE',
  'WEBHOOK_INVALID',
] as const;

export const RECONCILIATION_STATES = ['all', 'open', 'reconciled'] as const;
export type ReconciliationState = (typeof RECONCILIATION_STATES)[number];

export interface PaymentView {
  id: string;
  method: PaymentMethod;
  status: PaymentState;
  amount: string;
  paidAt: string | null;
  createdAt: string;
  /** Staff only. */
  receivedByName: string | null;
  /** Staff only. */
  checkoutOpen: boolean;
  /** Staff only: null until the payment is reconciled. */
  reconciledAt: string | null;
}

export interface InvoicePaymentsView {
  invoiceId: string;
  invoiceStatus: InvoiceStatus;
  total: string;
  paid: string;
  balance: string;
  openCheckoutId: string | null;
  payments: PaymentView[];
}

export interface PaymentDetailView {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  method: PaymentMethod;
  status: PaymentState;
  amount: string;
  checkoutOpen: boolean;
  /** True only while the FakeProvider is configured (development). */
  testCheckout: boolean;
}

export interface CashPaymentRequest {
  amount: string;
}

export interface CheckoutRequest {
  method: OnlinePaymentMethod;
}

export interface CheckoutStarted {
  payment: PaymentDetailView;
  checkoutUrl: string;
}

export interface CancelCheckoutRequest {
  reason?: string;
}

export type TestCheckoutOutcome = 'SUCCEEDED' | 'FAILED';

export interface TestCheckoutRequest {
  outcome: TestCheckoutOutcome;
}

export interface ReversePaymentRequest {
  reason: string;
}

export interface ReceiptEmailResult {
  /** Masked address, for example r***@example.com. */
  sentTo: string;
}

export interface ReconciliationRow {
  id: string;
  paidAt: string;
  method: PaymentMethod;
  amount: string;
  invoiceNumber: string | null;
  patientName: string;
  patientMrn: string;
  receivedByName: string | null;
  reconciledAt: string | null;
  reconciledByName: string | null;
}

export interface ReconciliationView {
  from: string;
  to: string;
  timezone: string;
  /** Totals for the rows matching the filter, by method. */
  totals: { method: PaymentMethod; count: number; amount: string }[];
  total: string;
  count: number;
  /** Unreconciled received payments in the period, whatever the filter. */
  unreconciled: { count: number; amount: string };
  /** True when more than the rows shown matched; totals are still complete. */
  truncated: boolean;
  rows: ReconciliationRow[];
}

export interface MarkReconciledRequest {
  paymentIds: string[];
}

export interface AccountantSummaryView {
  date: string;
  timezone: string;
  collectedToday: {
    total: string;
    count: number;
    byMethod: { method: PaymentMethod; count: number; amount: string }[];
  };
  outstanding: { invoices: number; amount: string };
  unreconciled: { count: number; amount: string };
  openCheckouts: number;
  /** Provider successes held for the accountant in the last 30 days (DEC-064). */
  heldWebhooks30d: number;
  claims: { submitted: number; approvedUnsettled: { count: number; amount: string } };
}

/** One received payment in the patient portal's payment history. */
export interface MyPaymentView extends PaymentView {
  invoiceId: string;
  invoiceNumber: string | null;
}
