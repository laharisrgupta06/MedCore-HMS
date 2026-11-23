/** Outgoing message adapters (DEC-003, DEC-011). Implementations never log message bodies. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

export interface SmsMessage {
  to: string;
  body: string;
}

export const MAIL_ADAPTER = Symbol('MAIL_ADAPTER');
export const SMS_ADAPTER = Symbol('SMS_ADAPTER');

export interface MailAdapter {
  send(message: EmailMessage): Promise<void>;
}

export interface SmsAdapter {
  send(message: SmsMessage): Promise<void>;
}
