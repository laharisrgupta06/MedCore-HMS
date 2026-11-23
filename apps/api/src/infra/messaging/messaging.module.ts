import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { DevSmsInboxAdapter } from './dev-sms-inbox.adapter';
import { DevSmsInboxController } from './dev-sms-inbox.controller';
import { MAIL_ADAPTER, SMS_ADAPTER } from './messaging.types';
import { SmtpMailAdapter } from './smtp-mail.adapter';
import { TwilioSmsAdapter } from './twilio-sms.adapter';

/** True only for local development with the dev SMS inbox. */
export function devSmsInboxEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' && (env.SMS_PROVIDER ?? 'dev-inbox') === 'dev-inbox';
}

@Global()
@Module({})
export class MessagingModule {
  static register(): DynamicModule {
    return {
      module: MessagingModule,
      controllers: devSmsInboxEnabled() ? [DevSmsInboxController] : [],
      providers: [
        SmtpMailAdapter,
        DevSmsInboxAdapter,
        TwilioSmsAdapter,
        { provide: MAIL_ADAPTER, useExisting: SmtpMailAdapter },
        {
          provide: SMS_ADAPTER,
          inject: [ConfigService, DevSmsInboxAdapter, TwilioSmsAdapter],
          useFactory: (
            c: ConfigService<Env, true>,
            dev: DevSmsInboxAdapter,
            twilio: TwilioSmsAdapter,
          ) => (c.get('SMS_PROVIDER', { infer: true }) === 'twilio' ? twilio : dev),
        },
      ],
      exports: [MAIL_ADAPTER, SMS_ADAPTER],
    };
  }
}
