import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CommonErrorCode } from '@medcore/types';
import { IS_PUBLIC, type AuthenticatedRequest } from './decorators';
import { SessionStore } from './session.store';
import { TokenService } from './token.service';

/**
 * Global guard: every route needs a valid access token unless marked @Public().
 * The session must still exist in Redis, so logout, logout-all and password reset take effect at once.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionStore,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    const unauthenticated = new UnauthorizedException({
      code: CommonErrorCode.UNAUTHENTICATED,
      message: 'Authentication required.',
    });
    if (scheme !== 'Bearer' || !token) throw unauthenticated;

    const claims = await this.tokens.verifyAccess(token);
    if (!claims || !(await this.sessions.exists(claims.sub, claims.sid))) throw unauthenticated;

    req.user = {
      userId: claims.sub,
      role: claims.role,
      hospitalId: claims.hid,
      sessionId: claims.sid,
    };
    return true;
  }
}
