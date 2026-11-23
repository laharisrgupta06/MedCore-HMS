import type {
  MeResponse,
  RegisterRequest,
  RegisterResponse,
  Role,
  SessionResponse,
} from '@medcore/types';
import { apiRequest } from '@/lib/api-client';

/** Thin wrappers over the existing /api/auth endpoints (docs/permissions-matrix.csv). */
export const authApi = {
  login: (email: string, password: string) =>
    apiRequest<SessionResponse>('/auth/login', {
      method: 'POST',
      json: { email, password },
      auth: false,
    }),
  refresh: () => apiRequest<SessionResponse>('/auth/refresh', { method: 'POST', auth: false }),
  logout: (allDevices: boolean) =>
    apiRequest<{ loggedOut: true }>('/auth/logout', {
      method: 'POST',
      json: { allDevices },
      auth: false,
    }),
  register: (body: RegisterRequest) =>
    apiRequest<RegisterResponse>('/auth/register', { method: 'POST', json: body, auth: false }),
  verifyEmail: (email: string, otp: string) =>
    apiRequest<{ verified: true }>('/auth/verify-email', {
      method: 'POST',
      json: { email, otp },
      auth: false,
    }),
  resendEmail: (email: string) =>
    apiRequest<{ message: string }>('/auth/verify-email/resend', {
      method: 'POST',
      json: { email },
      auth: false,
    }),
  forgotPassword: (email: string) =>
    apiRequest<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      json: { email },
      auth: false,
    }),
  resetPassword: (token: string, password: string) =>
    apiRequest<{ reset: true }>('/auth/reset-password', {
      method: 'POST',
      json: { token, password },
      auth: false,
    }),
  me: () => apiRequest<MeResponse>('/auth/me'),
  sendPhoneOtp: () => apiRequest<{ sentTo: string }>('/auth/verify-phone/send', { method: 'POST' }),
  verifyPhone: (otp: string) =>
    apiRequest<{ verified: true }>('/auth/verify-phone', { method: 'POST', json: { otp } }),
};

/** Where each role lands after sign-in. */
export function homeFor(role: Role): string {
  return role === 'PATIENT' ? '/portal' : '/dashboard';
}

/** Accepts only same-origin relative paths, so a crafted ?next= cannot redirect off-site. */
export function safeNext(next: string | null | undefined, role: Role): string {
  if (next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')) {
    const area = next.startsWith('/portal')
      ? '/portal'
      : next.startsWith('/dashboard')
        ? '/dashboard'
        : null;
    if (area === null || area === homeFor(role)) return next;
  }
  return homeFor(role);
}
