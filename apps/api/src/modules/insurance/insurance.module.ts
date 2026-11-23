import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { ClaimsController, InvoiceClaimsController } from './insurance.controller';
import { InsuranceService } from './insurance.service';

/** Insurance claim tracking (PRD 7.7). */
@Module({
  imports: [PaymentsModule],
  controllers: [InvoiceClaimsController, ClaimsController],
  providers: [InsuranceService],
  exports: [InsuranceService],
})
export class InsuranceModule {}
