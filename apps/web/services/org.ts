import type {
  Bed,
  BedStatus,
  BloodGroup,
  CreateHospitalRequest,
  Department,
  Doctor,
  Gender,
  Hospital,
  PatientSummary,
  Room,
  RoomType,
  StaffMember,
  StaffRole,
} from '@medcore/types';
import { apiList, apiRequest, qs } from '@/lib/api-client';

type Q = Record<string, string | number | boolean | undefined>;

export const hospitalsApi = {
  list: (q: Q) => apiList<Hospital>(`/hospitals${qs(q)}`),
  get: (id: string) => apiRequest<Hospital>(`/hospitals/${id}`),
  create: (b: CreateHospitalRequest) =>
    apiRequest<Hospital>('/hospitals', { method: 'POST', json: b }),
  update: (
    id: string,
    b: Partial<
      Pick<
        Hospital,
        | 'name'
        | 'email'
        | 'phone'
        | 'licenseNumber'
        | 'timezone'
        | 'currency'
        | 'defaultSlotMinutes'
        | 'invoicePrefix'
      >
    > & { taxRatePercent?: number },
  ) => apiRequest<Hospital>(`/hospitals/${id}`, { method: 'PATCH', json: b }),
  action: (id: string, action: 'verify' | 'suspend' | 'reactivate') =>
    apiRequest<Hospital>(`/hospitals/${id}/${action}`, { method: 'POST' }),
};

export const departmentsApi = {
  list: (hospitalId: string) => apiRequest<Department[]>(`/hospitals/${hospitalId}/departments`),
  create: (hospitalId: string, b: { name: string; description?: string | null }) =>
    apiRequest<Department>(`/hospitals/${hospitalId}/departments`, { method: 'POST', json: b }),
  update: (id: string, b: { name?: string; description?: string | null }) =>
    apiRequest<Department>(`/departments/${id}`, { method: 'PATCH', json: b }),
  remove: (id: string) => apiRequest<{ id: string }>(`/departments/${id}`, { method: 'DELETE' }),
};

export interface StaffInput {
  role: StaffRole;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  departmentId?: string | null;
  employeeCode?: string | null;
  designation?: string | null;
  isSeniorLabTechnician?: boolean;
}
export const staffApi = {
  list: (q: Q) => apiList<StaffMember>(`/staff${qs(q)}`),
  create: (b: StaffInput) => apiRequest<StaffMember>('/staff', { method: 'POST', json: b }),
  update: (
    userId: string,
    b: Partial<Omit<StaffInput, 'role' | 'firstName' | 'lastName' | 'email' | 'phone'>>,
  ) => apiRequest<StaffMember>(`/staff/${userId}`, { method: 'PATCH', json: b }),
  invite: (userId: string) =>
    apiRequest<{ sent: true }>(`/staff/${userId}/invite`, { method: 'POST' }),
};

export interface DoctorInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  registrationNumber: string;
  specialisation: string;
  qualification?: string | null;
  consultationFee: number;
  bio?: string | null;
  departmentIds: string[];
}
export const doctorsApi = {
  list: (q: Q) => apiList<Doctor>(`/doctors${qs(q)}`),
  get: (id: string) => apiRequest<Doctor>(`/doctors/${id}`),
  me: () => apiRequest<Doctor>('/doctors/me'),
  create: (b: DoctorInput) => apiRequest<Doctor>('/doctors', { method: 'POST', json: b }),
  update: (
    id: string,
    b: Partial<Omit<DoctorInput, 'firstName' | 'lastName' | 'email' | 'phone'>>,
  ) => apiRequest<Doctor>(`/doctors/${id}`, { method: 'PATCH', json: b }),
  uploadSignature: async (id: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return apiRequest<Doctor>(`/doctors/${id}/signature`, { method: 'POST', form: fd });
  },
};

export interface PatientInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  dateOfBirth: string;
  gender: Gender;
  bloodGroup?: BloodGroup | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
}
export const patientsApi = {
  list: (q: Q) => apiList<PatientSummary>(`/patients${qs(q)}`),
  me: () => apiRequest<PatientSummary>('/patients/me'),
  create: (b: PatientInput) => apiRequest<PatientSummary>('/patients', { method: 'POST', json: b }),
  update: (id: string, b: Partial<Omit<PatientInput, 'email'>>) =>
    apiRequest<PatientSummary>(`/patients/${id}`, { method: 'PATCH', json: b }),
};

export const facilitiesApi = {
  rooms: (q: Q = {}) => apiRequest<Room[]>(`/rooms${qs(q)}`),
  createRoom: (b: {
    number: string;
    type: RoomType;
    floor?: string | null;
    dailyCharge?: number | null;
    departmentId?: string | null;
  }) => apiRequest<Room>('/rooms', { method: 'POST', json: b }),
  updateRoom: (
    id: string,
    b: Partial<{
      number: string;
      type: RoomType;
      floor: string | null;
      dailyCharge: number | null;
      departmentId: string | null;
    }>,
  ) => apiRequest<Room>(`/rooms/${id}`, { method: 'PATCH', json: b }),
  deleteRoom: (id: string) => apiRequest<{ id: string }>(`/rooms/${id}`, { method: 'DELETE' }),
  addBed: (roomId: string, label: string) =>
    apiRequest<Bed>(`/rooms/${roomId}/beds`, { method: 'POST', json: { label } }),
  updateBed: (id: string, b: { label?: string; status?: BedStatus }) =>
    apiRequest<Bed>(`/beds/${id}`, { method: 'PATCH', json: b }),
  deleteBed: (id: string) => apiRequest<{ id: string }>(`/beds/${id}`, { method: 'DELETE' }),
};
