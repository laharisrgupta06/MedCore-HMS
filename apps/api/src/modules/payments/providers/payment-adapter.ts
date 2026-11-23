import type { PaymentProvider } from '@prisma/client';
import type { OnlinePaymentMethod } from '@medcore/types';

/**
 * The contract every online payment provider implements (task 8-B6, DEC-054). Business rules live in
 * PaymentsService; an adapter only talks to its provider and proves who sent a webhook. Adapters:
 * FakeProvider (development), StripeAdapter and RazorpayAdapter, chosen by PAYMENT_PROVIDER (DEC-003).
 */
export interface CheckoutInput {
  paymentId: string;
  amount: string;
  method: OnlinePaymentMethod;
  description: string;
}

export interface CheckoutSession {
  providerReference: string;
  checkoutUrl: string;
}

export interface ProviderEvent {
  provider: PaymentProvider;
  eventId: string;
  providerReference: string;
  outcome: 'SUCCEEDED' | 'FAILED';
  /** Amount the provider charged, when it reports one; the service checks it against MedCore's record. */
  amount: string | null;
}

export interface WebhookInput {
  rawBody: Buffer | undefined;
  headers: Record<string, string | string[] | undefined>;
}

export interface PaymentAdapter {
  readonly name: string;
  /** Whether this adapter can take the given method (Stripe: card; Razorpay: UPI and net banking). */
  supports(method: OnlinePaymentMethod): boolean;
  createCheckout(input: CheckoutInput): Promise<CheckoutSession>;
  /** Best effort: the payment is already marked cancelled in MedCore. */
  cancelCheckout(providerReference: string): Promise<void>;
  /**
   * Returns the verified event, null for a verified event MedCore does not act on, or throws
   * WebhookRejected for anything it cannot prove.
   */
  verifyWebhook(input: WebhookInput): ProviderEvent | null;
}

/** Thrown when a webhook cannot be verified. Never carries the payload or the secret. */
export class WebhookRejected extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'WebhookRejected';
  }
}

export const PAYMENT_ADAPTER = Symbol('PAYMENT_ADAPTER');

/** Header lookup that tolerates arrays and case (Node lower-cases incoming header names). */
export function header(h: WebhookInput['headers'], name: string): string | undefined {
  const v = h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

/** "123.45" to 12345 (paise), exact. */
export function toMinorUnits(amount: string): number {
  if (!/^\d{1,10}\.\d{2}$/.test(amount)) throw new Error('amount must have two decimals');
  return Number(amount.replace('.', ''));
}

/** 12345 (paise) to "123.45". */
export function fromMinorUnits(n: unknown): string | null {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) return null;
  const s = String(n).padStart(3, '0');
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

/** The HTTP call adapters make; injectable so tests never reach the network. */
export type HttpFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
