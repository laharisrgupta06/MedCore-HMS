import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env';
import { PrismaModule } from './infra/prisma/prisma.module';
import { REDIS_CLIENT } from './infra/redis/redis.constants';
import { RedisModule } from './infra/redis/redis.module';
import { AuthCoreModule } from './common/auth/auth-core.module';
import { GLOBAL_PIPELINE } from './common/global-pipeline';
import { TenancyModule } from './common/tenancy/tenancy.module';
import { MessagingModule } from './infra/messaging/messaging.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';
import { HospitalsModule } from './modules/hospitals/hospitals.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { StaffModule } from './modules/staff/staff.module';
import { DoctorsModule } from './modules/doctors/doctors.module';
import { PatientsModule } from './modules/patients/patients.module';
import { FacilitiesModule } from './modules/facilities/facilities.module';
import { FieldCryptoModule } from './infra/crypto/field-crypto';
import { StorageModule } from './infra/storage/storage.service';
import { EmrModule } from './modules/emr/emr.module';
import { DomainEventsModule } from './common/events/domain-events';
import { PdfCoreModule, PdfQueueModule } from './infra/pdf/pdf-jobs';
import { MedicinesModule } from './modules/medicines/medicines.module';
import { PrescriptionsModule } from './modules/prescriptions/prescriptions.module';
import { LabModule } from './modules/lab/lab.module';
import { TaxModule } from './modules/tax/tax.module';
import { BillingModule } from './modules/billing/billing.module';
import { ChargesModule } from './modules/billing/charges';
import { pharmacyJobs } from './modules/pharmacy/pharmacy-jobs.module';
import { PharmacyModule } from './modules/pharmacy/pharmacy.module';
import { RemindersModule, SchedulingModule } from './modules/appointments/appointments.module';

import { buildThrottlerOptions } from './infra/throttler/throttler-options';
export { buildThrottlerOptions, isAuthRateLimited } from './infra/throttler/throttler-options';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      // Single .env at the repository root; the API runs from apps/api.
      envFilePath: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')],
    }),
    PrismaModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, REDIS_CLIENT],
      useFactory: buildThrottlerOptions,
    }),
    MessagingModule.register(),
    AuditModule,
    AuthCoreModule,
    HealthModule,
    TenancyModule,
    AuthModule,
    UsersModule,
    StorageModule,
    FieldCryptoModule,
    HospitalsModule,
    DepartmentsModule,
    StaffModule,
    DoctorsModule,
    PatientsModule,
    FacilitiesModule,
    RemindersModule,
    SchedulingModule,
    EmrModule,
    DomainEventsModule,
    PdfCoreModule,
    PdfQueueModule,
    MedicinesModule,
    PrescriptionsModule,
    LabModule,
    TaxModule,
    BillingModule,
    ChargesModule,
    PharmacyModule,
    // The nightly expiry worker and its schedule exist only where timed jobs are enabled (never in
    // integration tests); ExpirySweep itself stays available through PharmacyModule.
    pharmacyJobs(),
  ],
  providers: GLOBAL_PIPELINE,
})
export class AppModule {}
