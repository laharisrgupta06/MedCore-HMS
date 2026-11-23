import { Controller, Get, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditRead } from '../../common/audit/audit.decorators';
import { CurrentUser, Roles, type AuthPrincipal } from '../../common/auth/decorators';
import { PortalService } from './portal.service';

@ApiTags('Patient portal')
@ApiBearerAuth()
@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('summary')
  @Roles('PATIENT')
  @AuditRead('portal.summary', 'Patient')
  @ApiOperation({
    summary: "The signed-in patient's dashboard: appointments, prescriptions, lab, billing, inbox",
  })
  summary(@CurrentUser() a: AuthPrincipal) {
    return this.portal.summary(a);
  }
}

/** Patient portal aggregates (Phase 10). Patient-only; self-scoped. */
@Module({ controllers: [PortalController], providers: [PortalService] })
export class PortalModule {}
