import type {
  IssuePrescriptionRequest,
  Medicine,
  MedicineForm,
  Prescription,
  PrescriptionStatus,
} from '@medcore/types';
import { apiBlob, apiList, apiRequest, qs } from '@/lib/api-client';

export const medicinesApi = {
  list: (q: {
    search?: string;
    form?: MedicineForm;
    active?: boolean;
    page?: number;
    limit?: number;
  }) => apiList<Medicine>(`/medicines${qs(q)}`),
  create: (b: {
    name: string;
    genericName?: string;
    form: MedicineForm;
    strength: string;
    reorderLevel: number;
  }) => apiRequest<Medicine>('/medicines', { method: 'POST', json: b }),
  update: (
    id: string,
    b: {
      name?: string;
      genericName?: string;
      strength?: string;
      reorderLevel?: number;
      isActive?: boolean;
    },
  ) => apiRequest<Medicine>(`/medicines/${id}`, { method: 'PATCH', json: b }),
};

export const prescriptionsApi = {
  list: (q: {
    patientId?: string;
    medicalRecordId?: string;
    status?: PrescriptionStatus;
    page?: number;
    limit?: number;
  }) => apiList<Prescription>(`/prescriptions${qs(q)}`),
  get: (id: string) => apiRequest<Prescription>(`/prescriptions/${id}`),
  issue: (b: IssuePrescriptionRequest) =>
    apiRequest<Prescription>('/prescriptions', { method: 'POST', json: b }),
  cancel: (id: string, reason: string) =>
    apiRequest<Prescription>(`/prescriptions/${id}/cancel`, { method: 'PATCH', json: { reason } }),
  pdf: (id: string) => apiBlob(`/prescriptions/${id}/pdf`),
  retryPdf: (id: string) =>
    apiRequest<Prescription>(`/prescriptions/${id}/pdf`, { method: 'POST' }),
};

/** Saves a blob as a file download in the browser. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
