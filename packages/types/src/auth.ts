import type { Role } from './roles';

/**
 * Permissions derived one-to-one from the role descriptions in PRD section 06 ("System Roles").
 * The backend enforces access with @Roles() guards and record-level checks; this list is what
 * GET /auth/me returns (AUTH-009) so the frontend can decide what to show. Hiding UI is not security.
 */
export const Permission = {
  // Super Admin
  PLATFORM_HOSPITALS_MANAGE: 'platform.hospitals.manage',
  PLATFORM_SUBSCRIPTIONS_MANAGE: 'platform.subscriptions.manage',
  PLATFORM_ANALYTICS_READ: 'platform.analytics.read',
  // Hospital Admin
  HOSPITAL_SETTINGS_MANAGE: 'hospital.settings.manage',
  DEPARTMENTS_MANAGE: 'departments.manage',
  STAFF_MANAGE: 'staff.manage',
  BEDS_MANAGE: 'beds.manage',
  HOSPITAL_ANALYTICS_READ: 'hospital.analytics.read',
  BILLING_CONFIG_MANAGE: 'billing.config.manage',
  // Doctor
  ENCOUNTERS_MANAGE: 'encounters.manage',
  EMR_WRITE: 'emr.write',
  EMR_READ: 'emr.read',
  PRESCRIPTIONS_WRITE: 'prescriptions.write',
  LAB_ORDERS_CREATE: 'lab-orders.create',
  AVAILABILITY_MANAGE: 'availability.manage',
  // Nurse
  VITALS_RECORD: 'vitals.record',
  ADMINISTRATION_NOTES_WRITE: 'administration-notes.write',
  WARDS_MANAGE: 'wards.manage',
  // Receptionist
  PATIENTS_REGISTER: 'patients.register',
  APPOINTMENTS_MANAGE: 'appointments.manage',
  INVOICES_CREATE: 'invoices.create',
  // Lab Technician
  LAB_ORDERS_PROCESS: 'lab-orders.process',
  LAB_RESULTS_WRITE: 'lab-results.write',
  LAB_REPORTS_APPROVE: 'lab-reports.approve',
  // Pharmacist
  PRESCRIPTIONS_VERIFY: 'prescriptions.verify',
  MEDICINES_DISPENSE: 'medicines.dispense',
  INVENTORY_MANAGE: 'inventory.manage',
  // Accountant
  FINANCE_REPORTS_READ: 'finance.reports.read',
  INSURANCE_CLAIMS_MANAGE: 'insurance-claims.manage',
  PAYMENTS_RECONCILE: 'payments.reconcile',
  // Patient
  OWN_RECORDS_READ: 'own.records.read',
  OWN_APPOINTMENTS_BOOK: 'own.appointments.book',
  OWN_REPORTS_DOWNLOAD: 'own.reports.download',
  OWN_PAYMENTS_MANAGE: 'own.payments.manage',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const P = Permission;

/**
 * Role to permission mapping (PRD section 06). LAB_REPORTS_APPROVE is additionally limited to
 * senior lab technicians at the endpoint (approved default: senior lab-tech flag).
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  SUPER_ADMIN: [
    P.PLATFORM_HOSPITALS_MANAGE,
    P.PLATFORM_SUBSCRIPTIONS_MANAGE,
    P.PLATFORM_ANALYTICS_READ,
  ],
  HOSPITAL_ADMIN: [
    P.HOSPITAL_SETTINGS_MANAGE,
    P.DEPARTMENTS_MANAGE,
    P.STAFF_MANAGE,
    P.BEDS_MANAGE,
    P.HOSPITAL_ANALYTICS_READ,
    P.BILLING_CONFIG_MANAGE,
  ],
  DOCTOR: [
    P.ENCOUNTERS_MANAGE,
    P.EMR_WRITE,
    P.EMR_READ,
    P.PRESCRIPTIONS_WRITE,
    P.LAB_ORDERS_CREATE,
    P.AVAILABILITY_MANAGE,
  ],
  NURSE: [P.VITALS_RECORD, P.ADMINISTRATION_NOTES_WRITE, P.WARDS_MANAGE, P.EMR_READ],
  RECEPTIONIST: [P.PATIENTS_REGISTER, P.APPOINTMENTS_MANAGE, P.INVOICES_CREATE],
  LAB_TECHNICIAN: [P.LAB_ORDERS_PROCESS, P.LAB_RESULTS_WRITE, P.LAB_REPORTS_APPROVE],
  PHARMACIST: [P.PRESCRIPTIONS_VERIFY, P.MEDICINES_DISPENSE, P.INVENTORY_MANAGE],
  ACCOUNTANT: [
    P.FINANCE_REPORTS_READ,
    P.INSURANCE_CLAIMS_MANAGE,
    P.PAYMENTS_RECONCILE,
    P.INVOICES_CREATE,
  ],
  PATIENT: [
    P.OWN_RECORDS_READ,
    P.OWN_APPOINTMENTS_BOOK,
    P.OWN_REPORTS_DOWNLOAD,
    P.OWN_PAYMENTS_MANAGE,
  ],
};

/** Password policy (DEC-012): 10 to 128 characters, at least one letter and one number, not the email. */
export const PASSWORD_POLICY = {
  minLength: 10,
  maxLength: 128,
  pattern: /^(?=.*[A-Za-z])(?=.*\d).+$/,
  description:
    '10 to 128 characters with at least one letter and one number, and not your email address.',
} as const;

export function checkPassword(password: string, email?: string): string | null {
  if (password.length < PASSWORD_POLICY.minLength || password.length > PASSWORD_POLICY.maxLength)
    return `Password must be ${PASSWORD_POLICY.minLength} to ${PASSWORD_POLICY.maxLength} characters.`;
  if (!PASSWORD_POLICY.pattern.test(password))
    return 'Password must contain at least one letter and one number.';
  if (email && password.trim().toLowerCase() === email.trim().toLowerCase())
    return 'Password must not be the same as your email address.';
  return null;
}

export const Gender = {
  MALE: 'MALE',
  FEMALE: 'FEMALE',
  OTHER: 'OTHER',
  UNDISCLOSED: 'UNDISCLOSED',
} as const;
export type Gender = (typeof Gender)[keyof typeof Gender];

/** Error codes returned by the /auth endpoints. */
export const AuthErrorCode = {
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  HOSPITAL_SUSPENDED: 'HOSPITAL_SUSPENDED',
  INVALID_HOSPITAL_CODE: 'INVALID_HOSPITAL_CODE',
  EMAIL_IN_USE: 'EMAIL_IN_USE',
  PASSWORD_POLICY: 'PASSWORD_POLICY',
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_ATTEMPTS_EXCEEDED: 'OTP_ATTEMPTS_EXCEEDED',
  OTP_RESEND_COOLDOWN: 'OTP_RESEND_COOLDOWN',
  PHONE_NOT_SET: 'PHONE_NOT_SET',
  REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID',
  REFRESH_TOKEN_REUSED: 'REFRESH_TOKEN_REUSED',
  RESET_TOKEN_INVALID: 'RESET_TOKEN_INVALID',
  CSRF_TOKEN_INVALID: 'CSRF_TOKEN_INVALID',
} as const;
export type AuthErrorCode = (typeof AuthErrorCode)[keyof typeof AuthErrorCode];

/** Cookie and header names shared by the API and the web app. */
export const AUTH_COOKIES = { refresh: 'mc_rt', csrf: 'mc_csrf' } as const;
export const CSRF_HEADER = 'x-csrf-token';
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface AuthUser {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string;
  role: Role;
  hospitalId: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
}

export interface AuthHospital {
  id: string;
  name: string;
  code: string;
}

/** GET /auth/me (AUTH-009). */
export interface MeResponse {
  user: AuthUser;
  hospital: AuthHospital | null;
  permissions: Permission[];
}

/** POST /auth/login and POST /auth/refresh. The refresh token travels only in the httpOnly cookie. */
export interface SessionResponse extends MeResponse {
  accessToken: string;
  expiresIn: number;
  /** New CSRF token (also set as the mc_csrf cookie). Rotated at every login and refresh. */
  csrfToken: string;
}

export interface RegisterRequest {
  hospitalCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  password: string;
  dateOfBirth: string;
  gender: Gender;
}

export interface RegisterResponse {
  userId: string;
  email: string;
  emailVerificationRequired: true;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface VerifyEmailRequest {
  email: string;
  otp: string;
}

export interface CsrfResponse {
  csrfToken: string;
}

/** GET /users, GET/PATCH /users/:id (API-012). Never includes credentials. */
export interface UserSummary {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string;
  role: Role;
  hospitalId: string | null;
  isActive: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}
