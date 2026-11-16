import type { Role } from '@medcore/types';
import {
  BedDouble,
  Building2,
  Home,
  Layers,
  type LucideIcon,
  Settings,
  Stethoscope,
  UserRound,
  Users,
  Contact,
} from 'lucide-react';

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
  { href: '/dashboard/hospitals', label: 'Hospitals', icon: Building2, roles: ['SUPER_ADMIN'] },
  {
    href: '/dashboard/patients',
    label: 'Patients',
    icon: Contact,
    roles: [
      'HOSPITAL_ADMIN',
      'RECEPTIONIST',
      'DOCTOR',
      'NURSE',
      'ACCOUNTANT',
      'LAB_TECHNICIAN',
      'PHARMACIST',
    ],
  },
  {
    href: '/dashboard/doctors',
    label: 'Doctors',
    icon: Stethoscope,
    roles: [
      'HOSPITAL_ADMIN',
      'DOCTOR',
      'NURSE',
      'RECEPTIONIST',
      'LAB_TECHNICIAN',
      'PHARMACIST',
      'ACCOUNTANT',
    ],
  },
  {
    href: '/dashboard/rooms',
    label: 'Rooms and beds',
    icon: BedDouble,
    roles: ['HOSPITAL_ADMIN', 'NURSE', 'RECEPTIONIST', 'DOCTOR', 'ACCOUNTANT'],
  },
  { href: '/dashboard/staff', label: 'Staff', icon: Users, roles: ['HOSPITAL_ADMIN'] },
  { href: '/dashboard/departments', label: 'Departments', icon: Layers, roles: ['HOSPITAL_ADMIN'] },
  {
    href: '/dashboard/hospital',
    label: 'Hospital settings',
    icon: Settings,
    roles: ['HOSPITAL_ADMIN'],
  },
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
