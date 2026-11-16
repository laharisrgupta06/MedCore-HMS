import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { mergeMap, Observable } from 'rxjs';
import { AuditService } from '../../modules/audit/audit.service';
import type { AuthenticatedRequest } from '../auth/decorators';
import { TenantContext } from '../tenancy/tenant-context';
import { AUDIT, SKIP_AUDIT, type AuditMeta } from './audit.decorators';

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function entityIdOf(req: Request, result: unknown): string | null {
  const param = (req.params as Record<string, string | undefined>)?.id;
  if (param) return param;
  const id = (result as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id : null;
}

/**
 * SEC-012: every successful create/update/delete is logged with user, IP, timestamp and the
 * (redacted) request body. Super Admin requests that used the cross-tenant client are logged too,
 * including reads (TEN-004). Failed requests change nothing and are not logged here.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const targets = [ctx.getHandler(), ctx.getClass()];
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_AUDIT, targets);
    const meta = this.reflector.getAllAndOverride<AuditMeta | undefined>(AUDIT, targets);
    const isWrite = WRITES.has(req.method);

    return next.handle().pipe(
      mergeMap(async (result) => {
        const store = TenantContext.store();
        const crossTenant = store?.crossTenantAccess === true;
        if (skip || (!isWrite && !crossTenant)) return result;
        const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
        const user = req.user;
        // Awaited so the entry exists before the client sees success.
        await this.audit.record({
          action:
            meta?.action ?? (isWrite ? `http.${req.method.toLowerCase()}` : 'super_admin.read'),
          entityType: meta?.entityType ?? ctx.getClass().name.replace(/Controller$/, ''),
          entityId: entityIdOf(req, result),
          actorId: user?.userId ?? null,
          hospitalId: user?.hospitalId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: req.get('user-agent') ?? null,
          changes: {
            method: req.method,
            route,
            ...(isWrite && req.body && Object.keys(req.body as object).length
              ? { body: req.body as Record<string, unknown> }
              : {}),
            ...(crossTenant ? { crossTenant: true } : {}),
          },
        });
        return result;
      }),
    );
  }
}
