import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CommonErrorCode } from '@medcore/types';
import { IS_PUBLIC, type AuthenticatedRequest } from '../auth/decorators';
import { TenantContext } from './tenant-context';

export const TENANT_PARAMS = 'medcore:tenantParams';

/**
 * Names route params or query keys that carry a hospital id (default: "hospitalId").
 * Example: @TenantParam('id') on GET /hospitals/:id/departments.
 */
export const TenantParam = (...names: string[]) => SetMetadata(TENANT_PARAMS, names);

/**
 * TEN-003: runs after JwtAuthGuard. Puts the principal into the tenant context and rejects any
 * request whose URL names another hospital, answering 404 as if the resource did not exist.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = req.user;
    if (!user) {
      if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
      return false; // JwtAuthGuard would already have rejected; never proceed without a principal
    }
    TenantContext.setPrincipal(user);
    if (user.role === 'SUPER_ADMIN') return true;

    const names = this.reflector.getAllAndOverride<string[] | undefined>(
      TENANT_PARAMS,
      targets,
    ) ?? ['hospitalId'];
    const query = req.query as Record<string, unknown>;
    for (const name of names) {
      for (const value of [req.params?.[name], query?.[name]]) {
        if (value !== undefined && value !== user.hospitalId) {
          throw new NotFoundException({
            code: CommonErrorCode.NOT_FOUND,
            message: 'The requested resource was not found.',
          });
        }
      }
    }
    return true;
  }
}
