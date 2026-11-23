import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env';
import type { PaymentAdapter } from './payment-adapter';
import { FakeProvider } from './fake-provider';
import { RazorpayAdapter } from './razorpay-adapter';
import { StripeAdapter } from './stripe-adapter';

/** Only used when FAKE_PAYMENT_WEBHOOK_SECRET is not set; a visible, development-only value. */
export const DEV_TEST_SECRET = 'medcore-dev-test-checkout-secret-not-for-production';

/**
 * Chooses the online payment adapter from configuration (env.ts validates the keys each mode needs).
 * Returns null when online payments are off: cash still works, and online attempts answer
 * PROVIDER_NOT_CONFIGURED.
 */
export function createPaymentAdapter(config: ConfigService<Env, true>): PaymentAdapter | null {
  const env = config.get('NODE_ENV', { infer: true });
  const web = config.get('WEB_APP_URL', { infer: true });
  const mode =
    config.get('PAYMENT_PROVIDER', { infer: true }) ?? (env === 'production' ? 'none' : 'fake');
  switch (mode) {
    case 'fake':
      return new FakeProvider(
        config.get('FAKE_PAYMENT_WEBHOOK_SECRET', { infer: true }) || DEV_TEST_SECRET,
        web,
      );
    case 'stripe':
      return new StripeAdapter({
        secretKey: config.get('STRIPE_SECRET_KEY', { infer: true }),
        webhookSecret: config.get('STRIPE_WEBHOOK_SECRET', { infer: true }),
        webBaseUrl: web,
      });
    case 'razorpay':
      return new RazorpayAdapter({
        keyId: config.get('RAZORPAY_KEY_ID', { infer: true }),
        keySecret: config.get('RAZORPAY_KEY_SECRET', { infer: true }),
        webhookSecret: config.get('RAZORPAY_WEBHOOK_SECRET', { infer: true }),
        webBaseUrl: web,
      });
    default:
      return null;
  }
}
