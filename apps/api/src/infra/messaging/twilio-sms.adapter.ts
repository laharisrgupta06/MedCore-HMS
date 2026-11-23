import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import type { SmsAdapter, SmsMessage } from './messaging.types';

/**
 * Production SMS through the Twilio REST API (AUTH-007). Requires TWILIO_* variables.
 * Not exercised locally: development always uses the dev inbox (DEC-011).
 */
@Injectable()
export class TwilioSmsAdapter implements SmsAdapter {
  constructor(private readonly config: ConfigService<Env, true>) {}

  async send(m: SmsMessage): Promise<void> {
    const sid = this.config.get('TWILIO_ACCOUNT_SID', { infer: true });
    const token = this.config.get('TWILIO_AUTH_TOKEN', { infer: true });
    const from = this.config.get('TWILIO_FROM_NUMBER', { infer: true });
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: m.to, From: from, Body: m.body }),
      },
    );
    if (!res.ok) throw new Error(`SMS provider rejected the message (HTTP ${res.status})`);
  }
}
