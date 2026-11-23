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

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  webBaseUrl: string;
  apiBase?: string;
}

/**
 * Razorpay Payment Links for UPI and net banking. Uses the documented REST API directly
 * (POST /v1/payment_links, POST /v1/payment_links/:id/cancel, HTTP Basic with key id and secret) and
 * Razorpay's webhook signature (X-Razorpay-Signature: hex HMAC-SHA256 of the raw body with the webhook
 * secret; event id in X-Razorpay-Event-Id). Not exercised against Razorpay yet: it needs test keys.
 */
export class RazorpayAdapter implements PaymentAdapter {
  readonly name = 'razorpay';
  private readonly api: string;

  constructor(
    private readonly cfg: RazorpayConfig,
    private readonly http: HttpFetch = (u, i) => fetch(u, i),
  ) {
    this.api = cfg.apiBase ?? 'https://api.razorpay.com';
  }

  supports(method: OnlinePaymentMethod): boolean {
    return method === 'RAZORPAY_UPI' || method === 'RAZORPAY_NETBANKING';
  }

  private headers(): Record<string, string> {
    const basic = Buffer.from(`${this.cfg.keyId}:${this.cfg.keySecret}`).toString('base64');
    return { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' };
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
    const back = `${this.cfg.webBaseUrl.replace(/\/$/, '')}/dashboard/payments/${input.paymentId}/return`;
    const method = input.method === 'RAZORPAY_UPI' ? 'upi' : 'netbanking';
    const res = await this.http(`${this.api}/v1/payment_links`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        amount: toMinorUnits(input.amount),
        currency: 'INR',
        accept_partial: false,
        description: input.description,
        // reference_id is unique per account at Razorpay, so a retried request cannot open a second link.
        reference_id: input.paymentId,
        notes: { medcore_payment_id: input.paymentId },
        callback_url: back,
        callback_method: 'get',
        options: { checkout: { method: { [method]: true } } },
      }),
    });
    const body = (await res.json()) as { id?: unknown; short_url?: unknown };
    if (!res.ok || typeof body.id !== 'string' || typeof body.short_url !== 'string')
      throw new Error(`Razorpay did not create a payment link (HTTP ${res.status})`);
    return { providerReference: body.id, checkoutUrl: body.short_url };
  }

  async cancelCheckout(providerReference: string): Promise<void> {
    await this.http(
      `${this.api}/v1/payment_links/${encodeURIComponent(providerReference)}/cancel`,
      {
        method: 'POST',
        headers: this.headers(),
      },
    );
  }

  verifyWebhook(input: WebhookInput): ProviderEvent | null {
    const raw = input.rawBody;
    const sig = header(input.headers, 'x-razorpay-signature');
    const eventId = header(input.headers, 'x-razorpay-event-id');
    if (!raw || !sig) throw new WebhookRejected('missing body or signature');
    if (!/^[0-9a-f]{64}$/.test(sig)) throw new WebhookRejected('malformed signature');
    const expected = createHmac('sha256', this.cfg.webhookSecret).update(raw).digest();
    if (!timingSafeEqual(Buffer.from(sig, 'hex'), expected))
      throw new WebhookRejected('signature mismatch');
    if (!eventId || eventId.length > 200) throw new WebhookRejected('missing event id');

    let evt: { event?: unknown; payload?: { payment_link?: { entity?: Record<string, unknown> } } };
    try {
      evt = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new WebhookRejected('body is not JSON');
    }
    const link = evt.payload?.payment_link?.entity;
    if (typeof evt.event !== 'string') throw new WebhookRejected('unexpected event shape');
    if (!evt.event.startsWith('payment_link.')) return null;
    if (!link || typeof link.id !== 'string') throw new WebhookRejected('unexpected event shape');
    const base = { provider: 'RAZORPAY' as const, eventId, providerReference: link.id };
    switch (evt.event) {
      case 'payment_link.paid':
        return { ...base, outcome: 'SUCCEEDED', amount: fromMinorUnits(link.amount_paid) };
      case 'payment_link.cancelled':
      case 'payment_link.expired':
        return { ...base, outcome: 'FAILED', amount: null };
      default:
        return null;
    }
  }
}
