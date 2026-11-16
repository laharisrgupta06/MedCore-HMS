import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  AUTH_COOKIES,
  CSRF_HEADER,
  REFRESH_TOKEN_TTL_SECONDS,
  type CsrfResponse,
  type MeResponse,
  type RegisterResponse,
  type SessionResponse,
} from '@medcore/types';
import type { CookieOptions, Request, Response } from 'express';
import { SkipAudit } from '../../common/audit/audit.decorators';
import { newCsrfToken } from '../../common/auth/csrf.guard';
import {
  AuthRateLimit,
  CurrentUser,
  Public,
  type AuthPrincipal,
} from '../../common/auth/decorators';
import type { Env } from '../../config/env';
import { API_PREFIX } from '../../app.setup';
import { AuthService, type IssuedSession, type RequestMeta } from './auth.service';
import {
  EmailDto,
  LoginDto,
  LogoutDto,
  OtpField,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto';

const GENERIC_EMAIL_SENT =
  'If an account exists for this email, we have sent the next steps to it.';

@ApiTags('Auth')
@ApiHeader({
  name: CSRF_HEADER,
  description: 'Required on POST: value of the mc_csrf cookie',
  required: false,
})
@AuthRateLimit()
@SkipAudit() // the service writes specific auth.* audit entries
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get secure(): boolean {
    return this.config.get('NODE_ENV', { infer: true }) === 'production';
  }

  private cookie(path: string, httpOnly: boolean, maxAgeMs?: number): CookieOptions {
    return {
      httpOnly,
      secure: this.secure,
      sameSite: 'strict',
      path,
      ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
    };
  }

  private static meta(req: Request): RequestMeta {
    return { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null };
  }

  private static refreshCookie(req: Request): string | undefined {
    const v = (req.cookies as Record<string, unknown> | undefined)?.[AUTH_COOKIES.refresh];
    return typeof v === 'string' ? v : undefined;
  }

  /** Sets the httpOnly refresh cookie (scoped to /api/auth) and a fresh CSRF cookie. */
  private startSession(res: Response, s: IssuedSession): SessionResponse {
    res.cookie(
      AUTH_COOKIES.refresh,
      s.refreshToken,
      this.cookie(`/${API_PREFIX}/auth`, true, REFRESH_TOKEN_TTL_SECONDS * 1000),
    );
    const csrfToken = newCsrfToken();
    res.cookie(AUTH_COOKIES.csrf, csrfToken, this.cookie('/', false));
    const { refreshToken: _omit, ...body } = s;
    void _omit;
    return { ...body, csrfToken };
  }

  private endSession(res: Response): void {
    res.clearCookie(AUTH_COOKIES.refresh, this.cookie(`/${API_PREFIX}/auth`, true));
  }

  @Public()
  @Get('csrf')
  @ApiOperation({ summary: 'Issue a CSRF token cookie; send it back in the x-csrf-token header' })
  csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response): CsrfResponse {
    const existing = (req.cookies as Record<string, unknown> | undefined)?.[AUTH_COOKIES.csrf];
    const token = typeof existing === 'string' && existing.length >= 32 ? existing : newCsrfToken();
    res.cookie(AUTH_COOKIES.csrf, token, this.cookie('/', false));
    return { csrfToken: token };
  }

  @Public()
  @Post('register')
  @ApiOperation({
    summary: 'Patient self-registration with a hospital code; sends an email OTP (AUTH-001)',
  })
  @ApiResponse({ status: 201, description: 'Account created; email verification required' })
  @ApiResponse({ status: 409, description: 'EMAIL_IN_USE' })
  register(@Body() dto: RegisterDto, @Req() req: Request): Promise<RegisterResponse> {
    return this.auth.register(dto, AuthController.meta(req));
  }

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm an email address with the 6-digit OTP (AUTH-006)' })
  verifyEmail(@Body() dto: VerifyEmailDto, @Req() req: Request): Promise<{ verified: true }> {
    return this.auth.verifyEmail(dto.email, dto.otp, AuthController.meta(req));
  }

  @Public()
  @Post('verify-email/resend')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Send a new email OTP. Same response whether or not the account exists',
  })
  async resendEmail(@Body() dto: EmailDto): Promise<{ message: string }> {
    await this.auth.resendEmailOtp(dto.email);
    return { message: GENERIC_EMAIL_SENT };
  }

  @Post('verify-phone/send')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send an SMS OTP to the signed-in user’s phone (AUTH-007)' })
  sendPhoneOtp(@CurrentUser() user: AuthPrincipal): Promise<{ sentTo: string }> {
    return this.auth.sendPhoneOtp(user.userId);
  }

  @Post('verify-phone')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirm the phone number with the SMS OTP (AUTH-007)' })
  verifyPhone(
    @CurrentUser() user: AuthPrincipal,
    @Body() dto: OtpField,
    @Req() req: Request,
  ): Promise<{ verified: true }> {
    return this.auth.verifyPhone(user.userId, dto.otp, AuthController.meta(req));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Sign in: access token (15 min) in the body, refresh token (7 days) in an httpOnly cookie (AUTH-002)',
  })
  @ApiResponse({ status: 401, description: 'INVALID_CREDENTIALS' })
  @ApiResponse({
    status: 403,
    description: 'EMAIL_NOT_VERIFIED, ACCOUNT_DISABLED or HOSPITAL_SUSPENDED',
  })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    return this.startSession(
      res,
      await this.auth.login(dto.email, dto.password, AuthController.meta(req)),
    );
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Exchange the refresh cookie for a new access token; rotates the refresh token (AUTH-003)',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    try {
      return this.startSession(
        res,
        await this.auth.refresh(AuthController.refreshCookie(req), AuthController.meta(req)),
      );
    } catch (e) {
      this.endSession(res);
      throw e;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Revoke this session, or every session with allDevices=true (AUTH-008)',
  })
  async logout(
    @Body() dto: LogoutDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ loggedOut: true }> {
    await this.auth.logout(
      AuthController.refreshCookie(req),
      dto.allDevices === true,
      AuthController.meta(req),
    );
    this.endSession(res);
    return { loggedOut: true };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Email a single-use reset link (30 min). Same response whether or not the account exists (AUTH-004)',
  })
  async forgotPassword(@Body() dto: EmailDto, @Req() req: Request): Promise<{ message: string }> {
    await this.auth.forgotPassword(dto.email, AuthController.meta(req));
    return { message: GENERIC_EMAIL_SENT };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Set a new password with the emailed token; signs out every device (AUTH-005)',
  })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
  ): Promise<{ reset: true }> {
    await this.auth.resetPassword(dto.token, dto.password, AuthController.meta(req));
    return { reset: true };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current user profile with role permissions (AUTH-009)' })
  me(@CurrentUser() user: AuthPrincipal): Promise<MeResponse> {
    return this.auth.me(user.userId);
  }
}
