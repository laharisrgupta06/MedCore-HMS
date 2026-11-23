import { createHmac } from 'node:crypto';
import { WebhookRejected } from './payment-adapter';
import { RazorpayAdapter } from './razorpay-adapter';
import { StripeAdapter } from './stripe-adapter';

const raw = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8');

describe('StripeAdapter (no network)', () => {
  const now = 1_800_000_000_000;
  const stripe = new StripeAdapter({
    secretKey: 'sk_test_x',
    webhookSecret: 'whsec_test',
    webBaseUrl: 'http://w',
    now: () => now,
  });
  const sign = (body: Buffer, t = Math.floor(now / 1000)) =>
    `t=${t},v1=${createHmac('sha256', 'whsec_test').update(`${t}.`).update(body).digest('hex')}`;
  const completed = raw({
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_1', payment_status: 'paid', amount_total: 12345 } },
  });

  it('verifies a signed completed session and converts paise', () => {
    expect(
      stripe.verifyWebhook({
        rawBody: completed,
        headers: { 'stripe-signature': sign(completed) },
      }),
    ).toEqual({
      provider: 'STRIPE',
      eventId: 'evt_1',
      providerReference: 'cs_1',
      outcome: 'SUCCEEDED',
      amount: '123.45',
    });
  });
  it('rejects tampering, stale timestamps and missing signatures', () => {
    const s = sign(completed);
    expect(() =>
      stripe.verifyWebhook({
        rawBody: Buffer.from(completed.toString().replace('12345', '99999')),
        headers: { 'stripe-signature': s },
      }),
    ).toThrow(WebhookRejected);
    expect(() =>
      stripe.verifyWebhook({
        rawBody: completed,
        headers: { 'stripe-signature': sign(completed, Math.floor(now / 1000) - 3600) },
      }),
    ).toThrow(WebhookRejected);
    expect(() => stripe.verifyWebhook({ rawBody: completed, headers: {} })).toThrow(
      WebhookRejected,
    );
  });
  it('ignores event types MedCore does not act on', () => {
    const b = raw({ id: 'evt_2', type: 'customer.created', data: { object: { id: 'cus_1' } } });
    expect(
      stripe.verifyWebhook({ rawBody: b, headers: { 'stripe-signature': sign(b) } }),
    ).toBeNull();
  });
  it('creates a session with an idempotency key and paise amount', async () => {
    const calls: { url: string; headers: Record<string, string>; body?: string }[] = [];
    const a = new StripeAdapter(
      { secretKey: 'sk', webhookSecret: 'w', webBaseUrl: 'http://w' },
      async (url, i) => {
        calls.push({ url, ...i });
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'cs_9', url: 'https://checkout.stripe.com/x' }),
        };
      },
    );
    await expect(
      a.createCheckout({
        paymentId: 'p1',
        amount: '10.50',
        method: 'STRIPE_CARD',
        description: 'd',
      }),
    ).resolves.toEqual({
      providerReference: 'cs_9',
      checkoutUrl: 'https://checkout.stripe.com/x',
    });
    expect(calls[0]!.headers['Idempotency-Key']).toBe('checkout-p1');
    expect(calls[0]!.body).toContain('unit_amount%5D=1050');
    expect(a.supports('RAZORPAY_UPI')).toBe(false);
  });
});

describe('RazorpayAdapter (no network)', () => {
  const rp = new RazorpayAdapter({
    keyId: 'rzp_test',
    keySecret: 's',
    webhookSecret: 'rzp_wh',
    webBaseUrl: 'http://w',
  });
  const paid = raw({
    event: 'payment_link.paid',
    payload: { payment_link: { entity: { id: 'plink_1', amount_paid: 50000 } } },
  });
  const sig = (b: Buffer) => createHmac('sha256', 'rzp_wh').update(b).digest('hex');

  it('verifies a signed paid link', () => {
    expect(
      rp.verifyWebhook({
        rawBody: paid,
        headers: { 'x-razorpay-signature': sig(paid), 'x-razorpay-event-id': 'ev_1' },
      }),
    ).toEqual({
      provider: 'RAZORPAY',
      eventId: 'ev_1',
      providerReference: 'plink_1',
      outcome: 'SUCCEEDED',
      amount: '500.00',
    });
  });
  it('rejects a wrong signature and a missing event id', () => {
    expect(() =>
      rp.verifyWebhook({
        rawBody: paid,
        headers: { 'x-razorpay-signature': 'a'.repeat(64), 'x-razorpay-event-id': 'e' },
      }),
    ).toThrow(WebhookRejected);
    expect(() =>
      rp.verifyWebhook({ rawBody: paid, headers: { 'x-razorpay-signature': sig(paid) } }),
    ).toThrow(WebhookRejected);
  });
  it('ignores non payment-link events', () => {
    const b = raw({ event: 'payment.captured', payload: {} });
    expect(
      rp.verifyWebhook({
        rawBody: b,
        headers: { 'x-razorpay-signature': sig(b), 'x-razorpay-event-id': 'e2' },
      }),
    ).toBeNull();
  });
});
