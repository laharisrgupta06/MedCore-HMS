/** The nine system roles defined in PRD section 06 ("System Roles"). */
export const Role = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  HOSPITAL_ADMIN: 'HOSPITAL_ADMIN',
  DOCTOR: 'DOCTOR',
  NURSE: 'NURSE',
  RECEPTIONIST: 'RECEPTIONIST',
  LAB_TECHNICIAN: 'LAB_TECHNICIAN',
  PHARMACIST: 'PHARMACIST',
  ACCOUNTANT: 'ACCOUNTANT',
  PATIENT: 'PATIENT',
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const ALL_ROLES: readonly Role[] = Object.values(Role);
