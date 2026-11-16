import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AuthErrorCode,
  checkPassword,
  REFRESH_TOKEN_TTL_SECONDS,
  ROLE_PERMISSIONS,
  type MeResponse,
  type RegisterResponse,
  type Role,
} from '@medcore/types';
import { Prisma, type Hospital, type User } from '@prisma/client';
import type { Redis } from 'ioredis';
import { SessionStore } from '../../common/auth/session.store';
import { TokenService } from '../../common/auth/token.service';
import type { Env } from '../../config/env';
import {
  MAIL_ADAPTER,
  SMS_ADAPTER,
  type MailAdapter,
  type SmsAdapter,
} from '../../infra/messaging/messaging.types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.constants';
import { AuditService } from '../audit/audit.service';
import type { RegisterDto } from './dto/auth.dto';
import { formatMrn } from './mrn';
import { OTP_TTL_SECONDS, OtpService } from './otp.service';
import { PasswordService } from './password.service';

export const RESET_TOKEN_TTL_SECONDS = 30 * 60;
const REFRESH_TTL_MS = REFRESH_TOKEN_TTL_SECONDS * 1000;
const MRN_RETRIES = 5;

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

/** A newly issued session. The refresh token goes only into the httpOnly cookie. */
export interface IssuedSession extends MeResponse {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

type UserWithHospital = User & { hospital: Hospital | null };

function err(code: string, message: string) {
  return { code, message };
}

function isUniqueViolation(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

function uniqueTarget(e: Prisma.PrismaClientKnownRequestError): string {
  const t = e.meta?.target;
  return Array.isArray(t) ? t.join(',') : String(t ?? '');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionStore,
    private readonly otp: OtpService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(MAIL_ADAPTER) private readonly mail: MailAdapter,
    @Inject(SMS_ADAPTER) private readonly sms: SmsAdapter,
  ) {}

  // ---------------------------------------------------------------- registration (AUTH-001)

  async register(dto: RegisterDto, meta: RequestMeta): Promise<RegisterResponse> {
    const policy = checkPassword(dto.password, dto.email);
    if (policy) throw new BadRequestException(err(AuthErrorCode.PASSWORD_POLICY, policy));

    const dob = new Date(`${dto.dateOfBirth}T00:00:00.000Z`);
    const today = new Date();
    const oldest = new Date(Date.UTC(today.getUTCFullYear() - 130, 0, 1));
    if (Number.isNaN(dob.getTime()) || dob > today || dob < oldest) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: [{ field: 'dateOfBirth', messages: ['dateOfBirth must be a past date'] }],
      });
    }

    const hospital = await this.prisma.hospital.findUnique({ where: { code: dto.hospitalCode } });
    if (!hospital || hospital.status !== 'VERIFIED') {
      throw new BadRequestException(
        err(
          AuthErrorCode.INVALID_HOSPITAL_CODE,
          'No active hospital uses this code. Check it with your hospital.',
        ),
      );
    }

    const emailInUse = new ConflictException(
      err(
        AuthErrorCode.EMAIL_IN_USE,
        'An account with this email already exists. Sign in or reset your password.',
      ),
    );
    if (await this.prisma.user.findUnique({ where: { email: dto.email }, select: { id: true } })) {
      throw emailInUse;
    }

    const passwordHash = await this.passwords.hash(dto.password);
    let user: User | undefined;
    for (let attempt = 0; attempt < MRN_RETRIES && !user; attempt++) {
      try {
        user = await this.prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: {
              hospitalId: hospital.id,
              email: dto.email,
              phone: dto.phone ?? null,
              passwordHash,
              role: 'PATIENT',
              firstName: dto.firstName,
              lastName: dto.lastName,
            },
          });
          const count = await tx.patient.count({ where: { hospitalId: hospital.id } });
          await tx.patient.create({
            data: {
              hospitalId: hospital.id,
              userId: created.id,
              mrn: formatMrn(today.getUTCFullYear(), count + 1 + attempt),
              dateOfBirth: dob,
              gender: dto.gender,
            },
          });
          return created;
        });
      } catch (e) {
        if (isUniqueViolation(e)) {
          if (uniqueTarget(e).includes('email')) throw emailInUse;
          if (uniqueTarget(e).includes('mrn')) continue; // concurrent registration took the number
        }
        throw e;
      }
    }
    if (!user)
      throw new ConflictException(err('CONFLICT', 'Registration is busy. Please try again.'));

    await this.audit.record({
      action: 'auth.register',
      entityType: 'User',
      entityId: user.id,
      actorId: user.id,
      hospitalId: hospital.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
    await this.sendEmailOtp(user).catch((e: Error) =>
      this.logger.warn(`Verification email not sent for user ${user.id}: ${e.message}`),
    );
    return { userId: user.id, email: user.email, emailVerificationRequired: true };
  }

  // ---------------------------------------------------------------- email verification (AUTH-006)

  private async sendEmailOtp(user: Pick<User, 'id' | 'email' | 'firstName'>): Promise<void> {
    const code = await this.otp.issue('email', user.id);
    const minutes = OTP_TTL_SECONDS / 60;
    await this.mail.send({
      to: user.email,
      subject: 'Your MedCore verification code',
      text: `Hello ${user.firstName},\n\nYour MedCore verification code is ${code}. It expires in ${minutes} minutes.\n\nIf you did not create an account, you can ignore this email.`,
    });
  }

  /** Always succeeds from the caller's point of view, so it cannot be used to discover accounts. */
  async resendEmailOtp(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.emailVerifiedAt || user.deletedAt || !user.isActive) return;
    try {
      await this.sendEmailOtp(user);
    } catch (e) {
      // A cooldown must look the same as an unknown address, so it is not reported to the caller.
      if (
        (e as { response?: { code?: string } }).response?.code === AuthErrorCode.OTP_RESEND_COOLDOWN
      )
        return;
      throw e;
    }
  }

  async verifyEmail(email: string, code: string, meta: RequestMeta): Promise<{ verified: true }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt) {
      throw new BadRequestException(err(AuthErrorCode.OTP_INVALID, 'The code is incorrect.'));
    }
    if (user.emailVerifiedAt) return { verified: true };
    await this.otp.verify('email', user.id, code);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });
    await this.audit.record({
      action: 'auth.email_verified',
      entityType: 'User',
      entityId: user.id,
      actorId: user.id,
      hospitalId: user.hospitalId,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
    return { verified: true };
  }

  // ---------------------------------------------------------------- phone verification (AUTH-007)

  async sendPhoneOtp(userId: string): Promise<{ sentTo: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.phone) {
      throw new BadRequestException(
        err(AuthErrorCode.PHONE_NOT_SET, 'Add a phone number to your profile first.'),
      );
    }
    const code = await this.otp.issue('phone', user.id);
    await this.sms.send({
      to: user.phone,
      body: `MedCore: your phone verification code is ${code}. It expires in ${OTP_TTL_SECONDS / 60} minutes.`,
    });
    return { sentTo: `${'*'.repeat(Math.max(0, user.phone.length - 4))}${user.phone.slice(-4)}` };
  }

  async verifyPhone(userId: string, code: string, meta: RequestMeta): Promise<{ verified: true }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.phone) {
      throw new BadRequestException(
        err(AuthErrorCode.PHONE_NOT_SET, 'Add a phone number to your profile first.'),
      );
    }
    if (user.phoneVerifiedAt) return { verified: true };
    await this.otp.verify('phone', user.id, code);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { phoneVerifiedAt: new Date() },
    });
    await this.audit.record({
      action: 'auth.phone_verified',
      entityType: 'User',
      entityId: user.id,
      actorId: user.id,
      hospitalId: user.hospitalId,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
    return { verified: true };
  }

  // ---------------------------------------------------------------- login, refresh, logout (AUTH-002/003/008)

  /** Rules every user must pass to hold a session. Shared by login and refresh. */
  private assertCanHoldSession(user: UserWithHospital): void {
    if (!user.isActive || user.deletedAt) {
      throw new ForbiddenException(
        err(
          AuthErrorCode.ACCOUNT_DISABLED,
          'This account is disabled. Contact your hospital administrator.',
        ),
      );
    }
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException(
        err(AuthErrorCode.EMAIL_NOT_VERIFIED, 'Verify your email address before signing in.'),
      );
    }
    if (user.role !== 'SUPER_ADMIN' && user.hospital?.status === 'SUSPENDED') {
      throw new ForbiddenException(
        err(
          AuthErrorCode.HOSPITAL_SUSPENDED,
          'Your hospital account is suspended. Contact MedCore support.',
        ),
      );
    }
  }

  async login(email: string, password: string, meta: RequestMeta): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { hospital: true },
    });
    const ok = await this.passwords.verify(password, user?.passwordHash);
    if (!user || !ok) {
      await this.audit.record({
        action: 'auth.login_failed',
        entityType: 'User',
        entityId: user?.id ?? null,
        actorId: user?.id ?? null,
        hospitalId: user?.hospitalId ?? null,
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException(
        err(AuthErrorCode.INVALID_CREDENTIALS, 'Email or password is incorrect.'),
      );
    }
    this.assertCanHoldSession(user);

    const sessionId = randomUUID();
    const jti = randomUUID();
    await this.sessions.create(user.id, sessionId, jti, REFRESH_TTL_MS);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      actorId: user.id,
      hospitalId: user.hospitalId,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      changes: { sessionId },
    });
    return this.issue(user, sessionId, jti);
  }

  /** Rotates the refresh token (SEC-004). Replaying an already-used token revokes all the user's sessions. */
  async refresh(refreshToken: string | undefined, meta: RequestMeta): Promise<IssuedSession> {
    const invalid = new UnauthorizedException(
      err(AuthErrorCode.REFRESH_TOKEN_INVALID, 'Your session has ended. Please sign in again.'),
    );
    if (!refreshToken) throw invalid;
    const claims = await this.tokens.verifyRefresh(refreshToken);
    if (!claims) throw invalid;

    const next = randomUUID();
    const result = await this.sessions.rotate(
      claims.sub,
      claims.sid,
      claims.jti,
      next,
      REFRESH_TTL_MS,
    );
    if (result === 'missing') throw invalid;
    if (result === 'reused') {
      // Approved design (ARCHITECTURE §6): reuse of a rotated token revokes every session of the user.
      await this.sessions.revokeAll(claims.sub);
      await this.audit.record({
        action: 'auth.refresh_reuse_detected',
        entityType: 'User',
        entityId: claims.sub,
        actorId: claims.sub,
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
        changes: { sessionId: claims.sid },
      });
      throw new UnauthorizedException(
        err(
          AuthErrorCode.REFRESH_TOKEN_REUSED,
          'For your security you have been signed out on all devices. Please sign in again.',
        ),
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      include: { hospital: true },
    });
    if (!user) {
      await this.sessions.revoke(claims.sub, claims.sid);
      throw invalid;
    }
    try {
      this.assertCanHoldSession(user);
    } catch (e) {
      await this.sessions.revoke(user.id, claims.sid);
      throw e;
    }
    return this.issue(user, claims.sid, next);
  }

  async logout(
    refreshToken: string | undefined,
    allDevices: boolean,
    meta: RequestMeta,
  ): Promise<void> {
    const claims = refreshToken ? await this.tokens.verifyRefresh(refreshToken) : null;
    if (!claims) return; // nothing to revoke; the cookies are cleared by the controller
    if (allDevices) await this.sessions.revokeAll(claims.sub);
    else await this.sessions.revoke(claims.sub, claims.sid);
    await this.audit.record({
      action: allDevices ? 'auth.logout_all' : 'auth.logout',
      entityType: 'User',
      entityId: claims.sub,
      actorId: claims.sub,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      changes: { sessionId: claims.sid },
    });
  }

  private async issue(
    user: UserWithHospital,
    sessionId: string,
    jti: string,
  ): Promise<IssuedSession> {
    const [accessToken, refreshToken] = await Promise.all([
      this.tokens.signAccess({
        sub: user.id,
        sid: sessionId,
        role: user.role as Role,
        hid: user.hospitalId,
      }),
      this.tokens.signRefresh({ sub: user.id, sid: sessionId, jti }),
    ]);
    return { ...this.toMe(user), accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, refreshToken };
  }

  // ---------------------------------------------------------------- password reset (AUTH-004/005)

  private static resetKey(token: string): string {
    return `pwreset:${createHash('sha256').update(token).digest('hex')}`;
  }

  /** Always succeeds from the caller's point of view, so it cannot be used to discover accounts. */
  async forgotPassword(email: string, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt || !user.isActive) return;
    const token = randomBytes(32).toString('base64url');
    await this.redis.set(AuthService.resetKey(token), user.id, 'EX', RESET_TOKEN_TTL_SECONDS);
    const link = new URL('/reset-password', this.config.get('WEB_APP_URL', { infer: true }));
    link.searchParams.set('token', token);
    await this.mail.send({
      to: user.email,
      subject: 'Reset your MedCore password',
      text: `Hello ${user.firstName},\n\nUse this link to choose a new password. It expires in ${RESET_TOKEN_TTL_SECONDS / 60} minutes and works once:\n\n${link.toString()}\n\nIf you did not ask for this, ignore this email; your password stays the same.`,
    });
    await this.audit.record({
      action: 'auth.password_reset_requested',
      entityType: 'User',
      entityId: user.id,
      actorId: user.id,
      hospitalId: user.hospitalId,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  /** Single-use token; on success every session of the user is revoked. */
  async resetPassword(token: string, password: string, meta: RequestMeta): Promise<void> {
    const invalid = new BadRequestException(
      err(
        AuthErrorCode.RESET_TOKEN_INVALID,
        'This reset link is invalid or has expired. Request a new one.',
      ),
    );
    const key = AuthService.resetKey(token);
    const userId = await this.redis.get(key);
    if (!userId) throw invalid;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt || !user.isActive) {
      await this.redis.del(key);
      throw invalid;
    }
    const policy = checkPassword(password, user.email);
    if (policy) throw new BadRequestException(err(AuthErrorCode.PASSWORD_POLICY, policy)); // token kept for retry
    if ((await this.redis.del(key)) !== 1) throw invalid; // consumed concurrently

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await this.passwords.hash(password),
        // Following the emailed link proves control of the address.
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      },
    });
    await this.sessions.revokeAll(user.id);
    await this.audit.record({
      action: 'auth.password_reset',
      entityType: 'User',
      entityId: user.id,
      actorId: user.id,
      hospitalId: user.hospitalId,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  // ---------------------------------------------------------------- current user (AUTH-009)

  async me(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { hospital: true },
    });
    if (!user || user.deletedAt || !user.isActive) {
      throw new UnauthorizedException(err('UNAUTHENTICATED', 'Authentication required.'));
    }
    return this.toMe(user);
  }

  private toMe(user: UserWithHospital): MeResponse {
    const role = user.role as Role;
    return {
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        role,
        hospitalId: user.hospitalId,
        emailVerified: user.emailVerifiedAt !== null,
        phoneVerified: user.phoneVerifiedAt !== null,
      },
      hospital: user.hospital
        ? { id: user.hospital.id, name: user.hospital.name, code: user.hospital.code }
        : null,
      permissions: [...ROLE_PERMISSIONS[role]],
    };
  }
}
