import { createHmac, timingSafeEqual } from 'node:crypto';
import type { OnlinePaymentMethod } from '@medcore/types';
import {
  WebhookRejected,
  fromMinorUnits,
  header,
  toMinorUnits,
  type CheckoutInput,
  type CheckoutSession,
  type HttpFetch,
  type PaymentAdapter,
  type ProviderEvent,
  type WebhookInput,
} from './payment-adapter';

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  webBaseUrl: string;
  /** Seconds a signed webhook stays valid (Stripe's library default is 300). */
  toleranceSeconds?: number;
  apiBase?: string;
  now?: () => number;
}

/**
 * Stripe Checkout (hosted page) for card payments. Uses the documented REST API directly
 * (POST /v1/checkout/sessions, POST /v1/checkout/sessions/:id/expire) and Stripe's webhook signature
 * scheme (Stripe-Signature: t=<ts>,v1=<HMAC-SHA256 of "<ts>.<raw body>">). Not exercised against
 * Stripe yet: it needs test-mode keys.
 */
export class StripeAdapter implements PaymentAdapter {
  readonly name = 'stripe';
  private readonly api: string;
  private readonly tolerance: number;
  private readonly now: () => number;

  constructor(
    private readonly cfg: StripeConfig,
    private readonly http: HttpFetch = (u, i) => fetch(u, i),
  ) {
    this.api = cfg.apiBase ?? 'https://api.stripe.com';
    this.tolerance = cfg.toleranceSeconds ?? 300;
    this.now = cfg.now ?? (() => Date.now());
  }

  supports(method: OnlinePaymentMethod): boolean {
    return method === 'STRIPE_CARD';
  }

  private headers(idempotencyKey?: string): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    };
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
    const back = `${this.cfg.webBaseUrl.replace(/\/$/, '')}/dashboard/payments/${input.paymentId}/return`;
    const form = new URLSearchParams({
      mode: 'payment',
      client_reference_id: input.paymentId,
      'metadata[medcore_payment_id]': input.paymentId,
      'payment_method_types[0]': 'card',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'inr',
      'line_items[0][price_data][unit_amount]': String(toMinorUnits(input.amount)),
      'line_items[0][price_data][product_data][name]': input.description,
      success_url: `${back}?result=success`,
      cancel_url: `${back}?result=cancelled`,
    });
    // The payment id is the idempotency key, so a retried request never opens a second session.
    const res = await this.http(`${this.api}/v1/checkout/sessions`, {
      method: 'POST',
      headers: this.headers(`checkout-${input.paymentId}`),
      body: form.toString(),
    });
    const body = (await res.json()) as { id?: unknown; url?: unknown };
    if (!res.ok || typeof body.id !== 'string' || typeof body.url !== 'string')
      throw new Error(`Stripe did not create a checkout session (HTTP ${res.status})`);
    return { providerReference: body.id, checkoutUrl: body.url };
  }

  async cancelCheckout(providerReference: string): Promise<void> {
    await this.http(
      `${this.api}/v1/checkout/sessions/${encodeURIComponent(providerReference)}/expire`,
      {
        method: 'POST',
        headers: this.headers(),
      },
    );
  }

  verifyWebhook(input: WebhookInput): ProviderEvent | null {
    const raw = input.rawBody;
    const sig = header(input.headers, 'stripe-signature');
    if (!raw || !sig) throw new WebhookRejected('missing body or signature');
    const parts = sig.split(',').map((p) => p.split('='));
    const t = parts.find(([k]) => k === 't')?.[1];
    const v1 = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '');
    if (!t || !/^\d+$/.test(t) || v1.length === 0) throw new WebhookRejected('malformed signature');
    if (Math.abs(this.now() / 1000 - Number(t)) > this.tolerance)
      throw new WebhookRejected('stale signature');
    const expected = createHmac('sha256', this.cfg.webhookSecret)
      .update(`${t}.`, 'utf8')
      .update(raw)
      .digest();
    const ok = v1.some((v) => {
      if (!/^[0-9a-f]{64}$/.test(v)) return false;
      return timingSafeEqual(Buffer.from(v, 'hex'), expected);
    });
    if (!ok) throw new WebhookRejected('signature mismatch');

    let evt: { id?: unknown; type?: unknown; data?: { object?: Record<string, unknown> } };
    try {
      evt = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new WebhookRejected('body is not JSON');
    }
    const obj = evt.data?.object;
    if (
      typeof evt.id !== 'string' ||
      typeof evt.type !== 'string' ||
      !obj ||
      typeof obj.id !== 'string'
    )
      throw new WebhookRejected('unexpected event shape');
    const base = { provider: 'STRIPE' as const, eventId: evt.id, providerReference: obj.id };
    switch (evt.type) {
      case 'checkout.session.completed':
        // Card payments are paid on completion; anything else waits for the async events below.
        if (obj.payment_status !== 'paid') return null;
        return { ...base, outcome: 'SUCCEEDED', amount: fromMinorUnits(obj.amount_total) };
      case 'checkout.session.async_payment_succeeded':
        return { ...base, outcome: 'SUCCEEDED', amount: fromMinorUnits(obj.amount_total) };
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired':
        return { ...base, outcome: 'FAILED', amount: null };
      default:
        return null;
    }
  }
}
