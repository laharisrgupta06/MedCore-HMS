import type { Provider } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuditInterceptor } from './audit/audit.interceptor';
import { CsrfGuard } from './auth/csrf.guard';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { TenantGuard } from './tenancy/tenant.guard';

/**
 * Global guards and interceptors, in execution order:
 * rate limit → CSRF → authentication → tenant context → roles; then the audit interceptor.
 * Shared by AppModule and the HTTP tests so both run the same pipeline.
 */
export const GLOBAL_PIPELINE: Provider[] = [
  { provide: APP_GUARD, useClass: ThrottlerGuard },
  { provide: APP_GUARD, useExisting: CsrfGuard },
  { provide: APP_GUARD, useExisting: JwtAuthGuard },
  { provide: APP_GUARD, useExisting: TenantGuard },
  { provide: APP_GUARD, useExisting: RolesGuard },
  { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
];
