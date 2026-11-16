/** Phase 3 API contracts: availability, slots and appointments (SCOPE-007..009, APPT-001..006). */

export const WEEKDAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface DoctorSchedule {
  id: string;
  doctorId: string;
  departmentId: string;
  weekday: Weekday;
  /** Local wall-clock time "HH:MM" in the hospital's time zone. */
  startTime: string;
  endTime: string;
  slotMinutes: number;
  validFrom: string;
  validTo: string | null;
  isActive: boolean;
}

export const EXCEPTION_TYPES = ['LEAVE', 'BLOCKED', 'EXTRA_HOURS'] as const;
export type ScheduleExceptionType = (typeof EXCEPTION_TYPES)[number];

export interface ScheduleException {
  id: string;
  doctorId: string;
  date: string;
  type: ScheduleExceptionType;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
}

export interface Slot {
  start: string;
  end: string;
  departmentId: string;
  available: boolean;
}

export const APPOINTMENT_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export const APPOINTMENT_TYPES = ['REGULAR', 'FOLLOW_UP', 'EMERGENCY'] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

/** Allowed status changes (APPT-003). */
export const APPOINTMENT_TRANSITIONS: Readonly<
  Record<AppointmentStatus, readonly AppointmentStatus[]>
> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export interface Appointment {
  id: string;
  scheduledAt: string;
  endAt: string;
  status: AppointmentStatus;
  type: AppointmentType;
  reason: string | null;
  cancellationReason: string | null;
  doctor: { id: string; firstName: string; lastName: string; specialisation: string };
  patient: { id: string; firstName: string; lastName: string; mrn: string };
  department: { id: string; name: string };
  createdAt: string;
}

export interface BookAppointmentRequest {
  doctorId: string;
  /** Required for reception and doctors; patients book for themselves. */
  patientId?: string;
  scheduledAt: string;
  type?: AppointmentType;
  /** Required for EMERGENCY bookings (no slot to derive it from). */
  departmentId?: string;
  reason?: string;
}

/** Patients may cancel online only up to this long before the start (DEC-038, owner 17:24). */
export const PATIENT_CANCEL_NOTICE_MS = 2 * 60 * 60 * 1000;

export const AppointmentErrorCode = {
  SLOT_UNAVAILABLE: 'SLOT_UNAVAILABLE',
  PATIENT_DOUBLE_BOOKED: 'PATIENT_DOUBLE_BOOKED',
  NOT_A_SLOT: 'NOT_A_SLOT',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  IN_THE_PAST: 'IN_THE_PAST',
  CANCELLATION_TOO_LATE: 'CANCELLATION_TOO_LATE',
} as const;
