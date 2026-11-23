import { Controller, Delete, Get, HttpCode } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipAudit } from '../../common/audit/audit.decorators';
import { Public } from '../../common/auth/decorators';
import { DevSmsInboxAdapter, type DevSmsRecord } from './dev-sms-inbox.adapter';

/**
 * Local development SMS inbox (DEC-011). Registered only when NODE_ENV is not production and
 * SMS_PROVIDER=dev-inbox; it does not exist in a production build's routing table.
 */
@ApiExcludeController()
@Public()
@SkipAudit() // development-only tool
@Controller('dev/sms-inbox')
export class DevSmsInboxController {
  constructor(private readonly inbox: DevSmsInboxAdapter) {}

  @Get()
  list(): Promise<DevSmsRecord[]> {
    return this.inbox.list();
  }

  @Delete()
  @HttpCode(204)
  async clear(): Promise<void> {
    await this.inbox.clear();
  }
}
