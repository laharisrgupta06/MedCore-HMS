import type { Role } from '@medcore/types';
import { Home, type LucideIcon, UserRound } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: readonly Role[];
}

const STAFF: readonly Role[] = [
  'SUPER_ADMIN',
  'HOSPITAL_ADMIN',
  'DOCTOR',
  'NURSE',
  'RECEPTIONIST',
  'LAB_TECHNICIAN',
  'PHARMACIST',
  'ACCOUNTANT',
];

/**
 * Navigation shows only routes that exist and that the role can use. The backend still enforces
 * every permission. New modules add their entries here as they ship.
 */
export const STAFF_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Home', icon: Home, roles: STAFF },
  { href: '/dashboard/account', label: 'My account', icon: UserRound, roles: STAFF },
];

export const PATIENT_NAV: NavItem[] = [
  { href: '/portal', label: 'Home', icon: Home, roles: ['PATIENT'] },
  { href: '/portal/account', label: 'My account', icon: UserRound, roles: ['PATIENT'] },
];

export const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  HOSPITAL_ADMIN: 'Hospital Admin',
  DOCTOR: 'Doctor',
  NURSE: 'Nurse',
  RECEPTIONIST: 'Receptionist',
  LAB_TECHNICIAN: 'Lab Technician',
  PHARMACIST: 'Pharmacist',
  ACCOUNTANT: 'Accountant',
  PATIENT: 'Patient',
};
