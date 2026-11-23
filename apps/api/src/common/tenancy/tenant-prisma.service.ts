import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { scopeArgs } from './tenant-scope';
import { TenantContext } from './tenant-context';

/**
 * The only database client feature modules use for tenant data (TEN-003/004).
 * - Hospital users get a client that is restricted to their hospital (scopeArgs).
 * - A Super Admin gets the unrestricted client; the request is flagged and audited as
 *   cross-tenant access by the AuditInterceptor.
 * - Outside an authenticated request it throws, so unscoped access is never accidental.
 */
@Injectable()
export class TenantPrismaService {
  private readonly cache = new Map<string, PrismaService>();

  constructor(private readonly prisma: PrismaService) {}

  /** A query-only extension does not change model types, so the result is typed as the base client. */
  private build(hospitalId: string): PrismaService {
    const extended = this.prisma.$extends({
      name: `tenant:${hospitalId}`,
      query: {
        $allModels: {
          $allOperations({ model, operation, args, query }) {
            return query(scopeArgs(model, operation, args as Record<string, unknown>, hospitalId));
          },
        },
      },
    });
    return extended as unknown as PrismaService;
  }

  /** Client for the current request's tenant. */
  get client(): PrismaService {
    const principal = TenantContext.principal();
    if (!principal) {
      throw new Error('TenantPrismaService used outside an authenticated request');
    }
    if (principal.role === 'SUPER_ADMIN') {
      const store = TenantContext.store();
      if (store) store.crossTenantAccess = true;
      return this.prisma;
    }
    if (!principal.hospitalId) throw new Error('Hospital user without hospitalId in token');
    let c = this.cache.get(principal.hospitalId);
    if (!c) {
      c = this.build(principal.hospitalId);
      if (this.cache.size > 1000) this.cache.clear();
      this.cache.set(principal.hospitalId, c);
    }
    return c;
  }
}
