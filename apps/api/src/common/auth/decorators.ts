import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@medcore/types';
import type { Request } from 'express';

export const IS_PUBLIC = 'medcore:isPublic';
export const ROLES = 'medcore:roles';
export const SKIP_CSRF = 'medcore:skipCsrf';
export const AUTH_RATE_LIMIT = 'medcore:authRateLimit';

/** Marks a route or controller as reachable without an access token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restricts a route or controller to the listed roles (ROLE-010). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** Exempts a route from the CSRF check. Only for server-to-server calls such as signed webhooks. */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

/** Applies the stricter auth rate limit (100 requests / 15 min per IP, SEC-005). */
export const AuthRateLimit = () => SetMetadata(AUTH_RATE_LIMIT, true);

/** The authenticated principal, taken only from the verified access token. */
export interface AuthPrincipal {
  userId: string;
  role: Role;
  /** Null only for SUPER_ADMIN. */
  hospitalId: string | null;
  sessionId: string;
}

export type AuthenticatedRequest = Request & { user?: AuthPrincipal };

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthPrincipal => {
    const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) throw new Error('CurrentUser used on a route without authentication');
    return user;
  },
);
