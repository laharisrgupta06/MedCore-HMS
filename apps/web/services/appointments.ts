import type {
  Appointment,
  AppointmentStatus,
  BookAppointmentRequest,
  DoctorSchedule,
  ScheduleException,
  ScheduleExceptionType,
  Slot,
  Weekday,
} from '@medcore/types';
import { apiList, apiRequest, qs } from '@/lib/api-client';

export const appointmentsApi = {
  list: (q: Record<string, string | number | undefined>) =>
    apiList<Appointment>(`/appointments${qs(q)}`),
  get: (id: string) => apiRequest<Appointment>(`/appointments/${id}`),
  book: (b: BookAppointmentRequest) =>
    apiRequest<Appointment>('/appointments', { method: 'POST', json: b }),
  setStatus: (id: string, status: AppointmentStatus, reason?: string) =>
    apiRequest<Appointment>(`/appointments/${id}/status`, {
      method: 'PATCH',
      json: { status, ...(reason ? { reason } : {}) },
    }),
  reschedule: (id: string, scheduledAt: string) =>
    apiRequest<Appointment>(`/appointments/${id}/reschedule`, {
      method: 'POST',
      json: { scheduledAt },
    }),
  slots: (doctorId: string, date: string) =>
    apiRequest<Slot[]>(`/doctors/${doctorId}/slots${qs({ date })}`),
};

export const availabilityApi = {
  schedules: (doctorId: string) => apiRequest<DoctorSchedule[]>(`/doctors/${doctorId}/schedules`),
  addSchedule: (
    doctorId: string,
    b: {
      departmentId: string;
      weekday: Weekday;
      startTime: string;
      endTime: string;
      slotMinutes: number;
      validFrom: string;
      validTo?: string | null;
    },
  ) => apiRequest<DoctorSchedule>(`/doctors/${doctorId}/schedules`, { method: 'POST', json: b }),
  updateSchedule: (id: string, b: { isActive?: boolean; validTo?: string | null }) =>
    apiRequest<DoctorSchedule>(`/schedules/${id}`, { method: 'PATCH', json: b }),
  removeSchedule: (id: string) =>
    apiRequest<{ id: string }>(`/schedules/${id}`, { method: 'DELETE' }),
  exceptions: (doctorId: string, from?: string) =>
    apiRequest<ScheduleException[]>(`/doctors/${doctorId}/exceptions${qs({ from })}`),
  addException: (
    doctorId: string,
    b: {
      date: string;
      type: ScheduleExceptionType;
      startTime?: string;
      endTime?: string;
      reason?: string | null;
    },
  ) =>
    apiRequest<ScheduleException>(`/doctors/${doctorId}/exceptions`, { method: 'POST', json: b }),
  removeException: (id: string) =>
    apiRequest<{ id: string }>(`/exceptions/${id}`, { method: 'DELETE' }),
};
