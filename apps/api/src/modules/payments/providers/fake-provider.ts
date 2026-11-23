import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PaymentProvider } from '@prisma/client';
import {
  WebhookRejected,
  type CheckoutInput,
  type CheckoutSession,
  type PaymentAdapter,
  type ProviderEvent,
  type WebhookInput,
} from './payment-adapter';

/** Header carrying the test signature. A real provider uses its own header and scheme. */
export const TEST_SIGNATURE_HEADER = 'x-medcore-test-signature';

/** The shape of a test event body, as a provider would deliver it. */
export interface TestEventBody {
  provider: PaymentProvider;
  eventId: string;
  providerReference: string;
  outcome: 'SUCCEEDED' | 'FAILED';
  amount: string;
}

/**
 * The development stand-in for Stripe and Razorpay (DEC-054: FakeProvider is the default for development
 * and all automated tests). It creates local checkouts and verifies webhooks with an HMAC-SHA256
 * signature, so the real verification path runs end to end without any external account.
 * Refused in production by configuration (env.ts).
 */
export class FakeProvider implements PaymentAdapter {
  readonly name = 'fake';

  supports(): boolean {
    return true;
  }

  constructor(
    private readonly secret: string,
    private readonly webBaseUrl: string,
  ) {}

  async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
    const providerReference = `fake_${randomUUID()}`;
    const base = this.webBaseUrl.replace(/\/+$/, '');
    return {
      providerReference,
      checkoutUrl: `${base}/dashboard/payments/${input.paymentId}/test-checkout`,
    };
  }

  async cancelCheckout(): Promise<void> {
    // Nothing to cancel remotely: the local checkout simply stops accepting an outcome.
  }

  /** Builds a test event body and its signature exactly as the webhook expects them. */
  signedEvent(event: TestEventBody): { body: string; signature: string } {
    const body = JSON.stringify(event);
    return { body, signature: this.sign(Buffer.from(body, 'utf8')) };
  }

  verifyWebhook({ rawBody, headers }: WebhookInput): ProviderEvent {
    const header = headers[TEST_SIGNATURE_HEADER];
    if (!rawBody || typeof header !== 'string') throw new WebhookRejected('signature missing');
    const expected = Buffer.from(this.sign(rawBody), 'hex');
    const given = Buffer.from(header, 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      throw new WebhookRejected('signature mismatch');
    return parseEvent(rawBody);
  }

  private sign(raw: Buffer): string {
    return createHmac('sha256', this.secret).update(raw).digest('hex');
  }
}

function parseEvent(raw: Buffer): ProviderEvent {
  let data: unknown;
  try {
    data = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new WebhookRejected('body is not JSON');
  }
  const e = data as Partial<Record<keyof TestEventBody, unknown>>;
  const provider = e.provider === 'STRIPE' || e.provider === 'RAZORPAY' ? e.provider : null;
  const outcome = e.outcome === 'SUCCEEDED' || e.outcome === 'FAILED' ? e.outcome : null;
  if (!provider || !outcome) throw new WebhookRejected('unknown provider or outcome');
  if (typeof e.eventId !== 'string' || e.eventId.length === 0 || e.eventId.length > 200)
    throw new WebhookRejected('event id missing');
  if (typeof e.providerReference !== 'string' || e.providerReference.length === 0)
    throw new WebhookRejected('provider reference missing');
  const amount =
    typeof e.amount === 'string' && /^\d{1,10}\.\d{2}$/.test(e.amount) ? e.amount : null;
  return { provider, eventId: e.eventId, providerReference: e.providerReference, outcome, amount };
}
