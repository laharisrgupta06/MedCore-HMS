import { Global, Module } from '@nestjs/common';
import { TenantPrismaService } from './tenant-prisma.service';
import { TenantGuard } from './tenant.guard';

@Global()
@Module({
  providers: [TenantPrismaService, TenantGuard],
  exports: [TenantPrismaService, TenantGuard],
})
export class TenancyModule {}
