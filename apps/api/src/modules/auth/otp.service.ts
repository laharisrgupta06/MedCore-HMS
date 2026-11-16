import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthErrorCode } from '@medcore/types';
import type { Redis } from 'ioredis';
import type { Env } from '../../config/env';
import { REDIS_CLIENT } from '../../infra/redis/redis.constants';

export type OtpPurpose = 'email' | 'phone';

export const OTP_TTL_SECONDS = 10 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

/**
 * 6-digit one-time codes (AUTH-006/007). Only an HMAC of the code is stored, in Redis with a
 * 10-minute TTL and a 5-attempt limit. Codes are never logged or returned by the API (DEC-011).
 */
@Injectable()
export class OtpService {
  private readonly key: Buffer;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    // Derived key: OTP digests cannot be recomputed without the server secret.
    this.key = createHmac('sha256', config.get('JWT_REFRESH_SECRET', { infer: true }))
      .update('medcore:otp:v1')
      .digest();
  }

  private digest(purpose: OtpPurpose, userId: string, code: string): string {
    return createHmac('sha256', this.key).update(`${purpose}:${userId}:${code}`).digest('hex');
  }

  private static k(purpose: OtpPurpose, userId: string) {
    return { otp: `otp:${purpose}:${userId}`, cooldown: `otp:cd:${purpose}:${userId}` };
  }

  /** Creates a new code, replacing any previous one. Throws OTP_RESEND_COOLDOWN within 60 s of the last. */
  async issue(purpose: OtpPurpose, userId: string): Promise<string> {
    const keys = OtpService.k(purpose, userId);
    const free = await this.redis.set(keys.cooldown, '1', 'EX', OTP_RESEND_COOLDOWN_SECONDS, 'NX');
    if (free !== 'OK') {
      throw new HttpException(
        {
          code: AuthErrorCode.OTP_RESEND_COOLDOWN,
          message: `Please wait ${OTP_RESEND_COOLDOWN_SECONDS} seconds before requesting another code.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.redis
      .multi()
      .del(keys.otp)
      .hset(keys.otp, 'h', this.digest(purpose, userId, code), 'a', '0')
      .expire(keys.otp, OTP_TTL_SECONDS)
      .exec();
    return code;
  }

  /** Verifies and consumes a code. Throws OTP_EXPIRED, OTP_INVALID or OTP_ATTEMPTS_EXCEEDED. */
  async verify(purpose: OtpPurpose, userId: string, code: string): Promise<void> {
    const keys = OtpService.k(purpose, userId);
    const stored = await this.redis.hget(keys.otp, 'h');
    if (!stored) {
      throw new HttpException(
        { code: AuthErrorCode.OTP_EXPIRED, message: 'This code has expired. Request a new one.' },
        HttpStatus.BAD_REQUEST,
      );
    }
    const attempts = await this.redis.hincrby(keys.otp, 'a', 1);
    if (attempts > OTP_MAX_ATTEMPTS) {
      await this.redis.del(keys.otp);
      throw new HttpException(
        {
          code: AuthErrorCode.OTP_ATTEMPTS_EXCEEDED,
          message: 'Too many incorrect attempts. Request a new code.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const a = Buffer.from(stored, 'hex');
    const b = Buffer.from(this.digest(purpose, userId, code), 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new HttpException(
        { code: AuthErrorCode.OTP_INVALID, message: 'The code is incorrect.' },
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.redis.del(keys.otp, keys.cooldown);
  }
}
