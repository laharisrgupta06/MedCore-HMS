import type { Role } from '@medcore/types';
import {
  BedDouble,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  Building2,
  HeartPulse,
  Home,
  Pill,
  Layers,
  type LucideIcon,
  Settings,
  Stethoscope,
  UserRound,
  Users,
  Contact,
  FlaskConical,
  TestTube,
  FileText,
  ClipboardCheck,
  BellRing,
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
    href: '/dashboard/appointments',
    label: 'Appointments',
    icon: CalendarDays,
    roles: ['HOSPITAL_ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST', 'ACCOUNTANT'],
  },
  {
    href: '/dashboard/availability',
    label: 'Availability',
    icon: CalendarClock,
    roles: ['HOSPITAL_ADMIN', 'DOCTOR'],
  },
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
  {
    href: '/dashboard/pharmacy',
    label: 'Pharmacy queue',
    icon: ClipboardCheck,
    roles: ['PHARMACIST'],
  },
  {
    href: '/dashboard/medicines',
    label: 'Inventory',
    icon: Pill,
    roles: ['PHARMACIST', 'HOSPITAL_ADMIN'],
  },
  {
    href: '/dashboard/pharmacy/alerts',
    label: 'Pharmacy alerts',
    icon: BellRing,
    roles: ['PHARMACIST', 'HOSPITAL_ADMIN'],
  },
  { href: '/dashboard/lab', label: 'Lab worklist', icon: FlaskConical, roles: ['LAB_TECHNICIAN'] },
  {
    href: '/dashboard/lab/samples',
    label: 'Lab samples',
    icon: TestTube,
    roles: ['RECEPTIONIST', 'LAB_TECHNICIAN'],
  },
  {
    href: '/dashboard/lab/tests',
    label: 'Lab tests',
    icon: FlaskConical,
    roles: ['HOSPITAL_ADMIN'],
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
  {
    href: '/portal/appointments',
    label: 'My appointments',
    icon: CalendarDays,
    roles: ['PATIENT'],
  },
  { href: '/portal/book', label: 'Book appointment', icon: CalendarPlus, roles: ['PATIENT'] },
  { href: '/portal/health', label: 'My health record', icon: HeartPulse, roles: ['PATIENT'] },
  { href: '/portal/prescriptions', label: 'Prescriptions', icon: Pill, roles: ['PATIENT'] },
  { href: '/portal/lab-reports', label: 'Lab reports', icon: FileText, roles: ['PATIENT'] },
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
