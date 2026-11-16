import type { Gender, UserSummary } from './auth';
import type { Role } from './roles';

/** Phase 2 API contracts: hospitals, departments, staff, doctors, patients, rooms and beds. */

export type HospitalStatus = 'PENDING' | 'VERIFIED' | 'SUSPENDED';
export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'SUSPENDED';

export interface Hospital {
  id: string;
  name: string;
  code: string;
  email: string;
  phone: string;
  licenseNumber: string;
  status: HospitalStatus;
  verifiedAt: string | null;
  timezone: string;
  currency: string;
  defaultSlotMinutes: number;
  taxRatePercent: string;
  invoicePrefix: string;
  subscriptionStatus: SubscriptionStatus;
  createdAt: string;
}

export interface CreateHospitalRequest {
  name: string;
  code: string;
  email: string;
  phone: string;
  licenseNumber: string;
  timezone?: string;
  currency?: string;
  admin: { firstName: string; lastName: string; email: string; phone?: string };
}

export interface Department {
  id: string;
  hospitalId: string;
  name: string;
  description: string | null;
}

/** Staff roles created through /staff (doctors use /doctors, patients /patients). */
export const STAFF_ROLES = [
  'HOSPITAL_ADMIN',
  'NURSE',
  'RECEPTIONIST',
  'LAB_TECHNICIAN',
  'PHARMACIST',
  'ACCOUNTANT',
] as const satisfies readonly Role[];
export type StaffRole = (typeof STAFF_ROLES)[number];

export interface StaffMember {
  user: UserSummary;
  employeeCode: string | null;
  designation: string | null;
  isSeniorLabTechnician: boolean;
  department: Pick<Department, 'id' | 'name'> | null;
}

export interface Doctor {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  registrationNumber: string;
  specialisation: string;
  qualification: string | null;
  consultationFee: string;
  bio: string | null;
  hasSignature: boolean;
  departments: Pick<Department, 'id' | 'name'>[];
}

export const BLOOD_GROUPS = [
  'A_POSITIVE',
  'A_NEGATIVE',
  'B_POSITIVE',
  'B_NEGATIVE',
  'AB_POSITIVE',
  'AB_NEGATIVE',
  'O_POSITIVE',
  'O_NEGATIVE',
] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

export interface PatientSummary {
  id: string;
  userId: string;
  mrn: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  dateOfBirth: string;
  gender: Gender;
  bloodGroup: BloodGroup | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  isActive: boolean;
  createdAt: string;
}

export const ROOM_TYPES = ['WARD', 'PRIVATE', 'ICU', 'CONSULTATION', 'OTHER'] as const;
export type RoomType = (typeof ROOM_TYPES)[number];
export const BED_STATUSES = ['AVAILABLE', 'OCCUPIED', 'MAINTENANCE'] as const;
export type BedStatus = (typeof BED_STATUSES)[number];

export interface Bed {
  id: string;
  roomId: string;
  label: string;
  status: BedStatus;
}

export interface Room {
  id: string;
  number: string;
  type: RoomType;
  floor: string | null;
  dailyCharge: string | null;
  department: Pick<Department, 'id' | 'name'> | null;
  beds: Bed[];
}
