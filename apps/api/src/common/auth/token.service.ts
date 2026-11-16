import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  ALL_ROLES,
  REFRESH_TOKEN_TTL_SECONDS,
  type Role,
} from '@medcore/types';
import type { Env } from '../../config/env';

export interface AccessClaims {
  sub: string;
  sid: string;
  role: Role;
  hid: string | null;
  typ: 'access';
}

export interface RefreshClaims {
  sub: string;
  sid: string;
  jti: string;
  typ: 'refresh';
}

/** Signs and verifies access (15 min) and refresh (7 days) JWTs with separate secrets (AUTH-002). */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  signAccess(c: Omit<AccessClaims, 'typ'>): Promise<string> {
    return this.jwt.signAsync(
      { ...c, typ: 'access' },
      {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        algorithm: 'HS256',
      },
    );
  }

  signRefresh(c: Omit<RefreshClaims, 'typ'>): Promise<string> {
    return this.jwt.signAsync(
      { sub: c.sub, sid: c.sid, typ: 'refresh' },
      {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
        expiresIn: REFRESH_TOKEN_TTL_SECONDS,
        jwtid: c.jti,
        algorithm: 'HS256',
      },
    );
  }

  /** Returns null for any invalid, expired or wrong-type token. Never throws details to callers. */
  async verifyAccess(token: string): Promise<AccessClaims | null> {
    try {
      const c = await this.jwt.verifyAsync<AccessClaims>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        algorithms: ['HS256'],
      });
      const ok =
        c.typ === 'access' &&
        typeof c.sub === 'string' &&
        typeof c.sid === 'string' &&
        ALL_ROLES.includes(c.role) &&
        (c.hid === null || typeof c.hid === 'string');
      return ok ? c : null;
    } catch {
      return null;
    }
  }

  async verifyRefresh(token: string): Promise<RefreshClaims | null> {
    try {
      const c = await this.jwt.verifyAsync<RefreshClaims>(token, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
        algorithms: ['HS256'],
      });
      return c.typ === 'refresh' && typeof c.sub === 'string' && typeof c.sid === 'string' && c.jti
        ? c
        : null;
    } catch {
      return null;
    }
  }
}
