import { createHmac } from 'node:crypto';
import { FakeProvider, TEST_SIGNATURE_HEADER, type TestEventBody } from './fake-provider';
import { WebhookRejected } from './payment-adapter';

const SECRET = 's'.repeat(32);
const event: TestEventBody = {
  provider: 'STRIPE',
  eventId: 'test_evt_1',
  providerReference: 'fake_abc',
  outcome: 'SUCCEEDED',
  amount: '120.00',
};

describe('FakeProvider (8-B6)', () => {
  const provider = new FakeProvider(SECRET, 'http://localhost:3000/');

  const verify = (body: string, signature: string | undefined, p = provider) =>
    p.verifyWebhook({
      rawBody: Buffer.from(body, 'utf8'),
      headers: signature === undefined ? {} : { [TEST_SIGNATURE_HEADER]: signature },
    });

  it('creates a checkout with a unique reference under the web app', async () => {
    const a = await provider.createCheckout({
      paymentId: 'p1',
      amount: '120.00',
      method: 'STRIPE_CARD',
      description: 'x',
    });
    const b = await provider.createCheckout({
      paymentId: 'p2',
      amount: '5.00',
      method: 'RAZORPAY_UPI',
      description: 'x',
    });
    expect(a.providerReference).not.toBe(b.providerReference);
    expect(a.checkoutUrl).toBe('http://localhost:3000/dashboard/payments/p1/test-checkout');
  });

  it('accepts an event signed with the same secret and returns its fields', () => {
    const { body, signature } = provider.signedEvent(event);
    expect(verify(body, signature)).toEqual({
      provider: 'STRIPE',
      eventId: 'test_evt_1',
      providerReference: 'fake_abc',
      outcome: 'SUCCEEDED',
      amount: '120.00',
    });
  });

  it('rejects a body changed after signing', () => {
    const { body, signature } = provider.signedEvent(event);
    expect(() => verify(body.replace('120.00', '999.00'), signature)).toThrow(WebhookRejected);
  });

  it('rejects a request without a signature', () => {
    const { body } = provider.signedEvent(event);
    expect(() => verify(body, undefined)).toThrow(WebhookRejected);
  });

  it('rejects a signature made with another secret', () => {
    const other = new FakeProvider('x'.repeat(32), 'http://localhost:3000');
    const { body, signature } = other.signedEvent(event);
    expect(() => verify(body, signature)).toThrow(WebhookRejected);
  });

  it('rejects a correctly signed body that is not JSON', () => {
    const body = 'not json';
    const signature = createHmac('sha256', SECRET).update(body, 'utf8').digest('hex');
    expect(() => verify(body, signature)).toThrow(WebhookRejected);
  });

  it('rejects a correctly signed event with an unknown outcome', () => {
    const body = JSON.stringify({ ...event, outcome: 'PENDING' });
    const signature = createHmac('sha256', SECRET).update(body, 'utf8').digest('hex');
    expect(() => verify(body, signature)).toThrow(WebhookRejected);
  });
});
