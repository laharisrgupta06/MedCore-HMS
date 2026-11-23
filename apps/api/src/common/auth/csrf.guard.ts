import { randomBytes, timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTH_COOKIES, AuthErrorCode, CSRF_HEADER } from '@medcore/types';
import type { Request } from 'express';
import { SKIP_CSRF } from './decorators';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * CSRF protection (SEC-010): SameSite=Strict cookies plus a double-submit token. Every
 * state-changing request must send the mc_csrf cookie value in the x-csrf-token header.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    if (SAFE.has(req.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [ctx.getHandler(), ctx.getClass()]))
      return true;

    const cookies = req.cookies as Record<string, unknown> | undefined;
    const cookie = cookies?.[AUTH_COOKIES.csrf];
    const header = req.headers[CSRF_HEADER];
    if (typeof cookie === 'string' && typeof header === 'string' && cookie.length >= 32) {
      const a = Buffer.from(cookie);
      const b = Buffer.from(header);
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    }
    throw new ForbiddenException({
      code: AuthErrorCode.CSRF_TOKEN_INVALID,
      message: 'Missing or invalid CSRF token. Reload the page and try again.',
    });
  }
}
