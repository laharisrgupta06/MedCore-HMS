import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '../../common/audit/audit.decorators';
import { CurrentUser, Roles, type AuthPrincipal } from '../../common/auth/decorators';
import { MedicinesModule } from '../medicines/medicines.module';
import { AlertsService } from './alerts.service';
import { BatchesService } from './batches.service';
import { DispensingService } from './dispensing.service';
import { ExpirySweep } from './expiry-sweep';
import {
  AdjustmentDto,
  DispenseDto,
  LedgerQuery,
  QueueQuery,
  ReasonDto,
  ReceiveBatchDto,
} from './pharmacy.dto';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Batches (PHARM-001, PHARM-004). Costs are shown to pharmacists and hospital admins only. */
@ApiTags('Pharmacy')
@ApiBearerAuth()
@Controller()
export class BatchesController {
  constructor(private readonly batches: BatchesService) {}

  @Get('medicines/:id/batches')
  @Roles('PHARMACIST', 'HOSPITAL_ADMIN')
  @ApiOperation({ summary: 'Batches of a medicine in FIFO order (earliest expiry first)' })
  list(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.batches.list(a, id);
  }

  @Post('medicines/:id/batches')
  @Roles('PHARMACIST')
  @Audit('batch.receive', 'Medicine', ['batchNumber', 'quantity', 'expiresOn'])
  @ApiOperation({ summary: 'Receive stock: a new batch and its RECEIPT ledger entry' })
  receive(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: ReceiveBatchDto,
  ) {
    return this.batches.receive(a, id, dto);
  }

  @Patch('batches/:id/quarantine')
  @Roles('PHARMACIST')
  @Audit('batch.quarantine', 'MedicineBatch', ['reason'])
  @ApiOperation({
    summary: 'Quarantine a batch with a reason (quantity unchanged, units set aside)',
  })
  quarantine(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.batches.quarantine(a, id, dto.reason);
  }

  @Post('batches/:id/adjustments')
  @Roles('PHARMACIST')
  @Audit('batch.adjust', 'MedicineBatch', ['quantity', 'reason'])
  @ApiOperation({ summary: 'Count correction with a reason; never below zero' })
  adjust(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: AdjustmentDto,
  ) {
    return this.batches.adjust(a, id, dto);
  }
}

/** Verification, dispensing, alerts and ledger (PHARM-002..006). */
@ApiTags('Pharmacy')
@ApiBearerAuth()
@Controller('pharmacy')
export class PharmacyController {
  constructor(
    private readonly dispensing: DispensingService,
    private readonly alertsService: AlertsService,
  ) {}

  @Get('prescriptions')
  @Roles('PHARMACIST')
  @ApiOperation({ summary: 'Verification and dispensing queue, oldest first' })
  queue(@CurrentUser() a: AuthPrincipal, @Query() q: QueueQuery) {
    return this.dispensing.queue(a, q);
  }

  @Patch('prescriptions/:id/verify')
  @Roles('PHARMACIST')
  @Audit('prescription.verify', 'Prescription')
  @ApiOperation({ summary: 'Record pharmacist verification' })
  verify(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.dispensing.verify(a, id);
  }

  @Post('prescriptions/:id/dispense')
  @Roles('PHARMACIST')
  @Audit('prescription.dispense', 'Prescription')
  @ApiOperation({ summary: 'Dispense items FIFO from active, unexpired batches' })
  dispense(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: DispenseDto,
  ) {
    return this.dispensing.dispense(a, id, dto);
  }

  @Patch('prescriptions/:id/handover')
  @Roles('PHARMACIST')
  @Audit('prescription.handover', 'Prescription')
  @ApiOperation({ summary: 'The patient collected the medicines' })
  handover(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.dispensing.handover(a, id);
  }

  @Get('alerts')
  @Roles('PHARMACIST', 'HOSPITAL_ADMIN')
  @ApiOperation({ summary: 'Low stock, expiring within 30 days, and the latest nightly report' })
  alerts(@CurrentUser() a: AuthPrincipal) {
    return this.alertsService.alerts(a);
  }

  @Get('ledger')
  @Roles('PHARMACIST', 'HOSPITAL_ADMIN')
  @ApiOperation({ summary: 'Stock movements, newest first' })
  ledger(@CurrentUser() a: AuthPrincipal, @Query() q: LedgerQuery) {
    return this.alertsService.ledger(a, q);
  }
}

@Module({
  imports: [MedicinesModule],
  controllers: [BatchesController, PharmacyController],
  providers: [BatchesService, DispensingService, AlertsService, ExpirySweep],
  exports: [ExpirySweep],
})
export class PharmacyModule {}
