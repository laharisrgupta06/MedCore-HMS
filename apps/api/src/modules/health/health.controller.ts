import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../../common/auth/decorators';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { CommonErrorCode, type HealthStatus } from '@medcore/types';
import { HealthService } from './health.service';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @SkipThrottle()
  @ApiOperation({
    summary: 'Liveness and dependency check',
    description:
      'Public. Returns 200 when PostgreSQL, Redis and the job queue respond, otherwise 503.',
  })
  async get(): Promise<HealthStatus> {
    const status = await this.health.check();
    if (status.status !== 'ok') {
      throw new ServiceUnavailableException({
        code: CommonErrorCode.SERVICE_UNAVAILABLE,
        message: 'One or more dependencies are unavailable.',
        details: status,
      });
    }
    return status;
  }
}
