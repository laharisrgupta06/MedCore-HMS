import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CommonErrorCode, type Role } from '@medcore/types';
import { IS_PUBLIC, ROLES, type AuthenticatedRequest } from './decorators';

/** Global RBAC guard driven by @Roles() (ROLE-010). Routes without @Roles() allow any authenticated user. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (!roles || roles.length === 0) return true;
    const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (user && roles.includes(user.role)) return true;
    throw new ForbiddenException({
      code: CommonErrorCode.FORBIDDEN,
      message: 'You do not have permission to perform this action.',
    });
  }
}
