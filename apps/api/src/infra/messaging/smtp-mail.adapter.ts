import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../../config/env';
import type { EmailMessage, MailAdapter } from './messaging.types';

/** SMTP delivery. In development this points at Mailpit (localhost:1025, web UI on :8025). */
@Injectable()
export class SmtpMailAdapter implements MailAdapter {
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(config: ConfigService<Env, true>) {
    const user = config.get('SMTP_USER', { infer: true });
    this.transport = createTransport({
      host: config.get('SMTP_HOST', { infer: true }),
      port: config.get('SMTP_PORT', { infer: true }),
      secure: config.get('SMTP_SECURE', { infer: true }),
      ...(user ? { auth: { user, pass: config.get('SMTP_PASS', { infer: true }) } } : {}),
    });
    this.from = config.get('MAIL_FROM', { infer: true });
  }

  async send(m: EmailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: m.to,
      subject: m.subject,
      text: m.text,
      html: m.html,
    });
  }
}
