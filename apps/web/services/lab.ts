import type {
  LabOrder,
  LabOrderStatus,
  LabPriority,
  LabRange,
  LabTest,
  LabTestCategory,
} from '@medcore/types';
import { apiBlob, apiList, apiRequest, qs } from '@/lib/api-client';

export type LabTestInput = {
  code?: string;
  name: string;
  category?: LabTestCategory;
  unit?: string;
  sampleType?: string;
  price: number;
  ranges?: LabRange[];
  isActive?: boolean;
};

export const labApi = {
  tests: (q: {
    search?: string;
    category?: LabTestCategory;
    active?: boolean;
    page?: number;
    limit?: number;
  }) => apiList<LabTest>(`/lab-tests${qs(q)}`),
  createTest: (b: LabTestInput) => apiRequest<LabTest>('/lab-tests', { method: 'POST', json: b }),
  updateTest: (id: string, b: Partial<LabTestInput>) =>
    apiRequest<LabTest>(`/lab-tests/${id}`, { method: 'PATCH', json: b }),
  orders: (q: {
    status?: LabOrderStatus;
    priority?: LabPriority;
    patientId?: string;
    medicalRecordId?: string;
    mine?: boolean;
    page?: number;
    limit?: number;
  }) => apiList<LabOrder>(`/lab-orders${qs(q)}`),
  order: (id: string) => apiRequest<LabOrder>(`/lab-orders/${id}`),
  create: (b: {
    medicalRecordId: string;
    testIds: string[];
    priority?: LabPriority;
    clinicalNotes?: string;
  }) => apiRequest<LabOrder>('/lab-orders', { method: 'POST', json: b }),
  cancel: (id: string, reason: string) =>
    apiRequest<LabOrder>(`/lab-orders/${id}/cancel`, { method: 'PATCH', json: { reason } }),
  sample: (id: string) =>
    apiRequest<LabOrder>(`/lab-orders/${id}/sample`, { method: 'PATCH', json: {} }),
  processing: (id: string) =>
    apiRequest<LabOrder>(`/lab-orders/${id}/processing`, { method: 'PATCH', json: {} }),
  results: (
    id: string,
    results: { itemId: string; valueNumeric?: number; valueText?: string }[],
    submit = false,
  ) =>
    apiRequest<LabOrder>(`/lab-orders/${id}/result`, {
      method: 'PATCH',
      json: { results, ...(submit ? { submit } : {}) },
    }),
  attach: (id: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return apiRequest<LabOrder>(`/lab-orders/${id}/report-file`, { method: 'POST', form: fd });
  },
  approve: (id: string) =>
    apiRequest<LabOrder>(`/lab-orders/${id}/approve`, { method: 'PATCH', json: {} }),
  reject: (id: string, reason: string) =>
    apiRequest<LabOrder>(`/lab-orders/${id}/reject`, { method: 'PATCH', json: { reason } }),
  amend: (id: string, reason: string) =>
    apiRequest<LabOrder>(`/lab-orders/${id}/amend`, { method: 'POST', json: { reason } }),
  report: (id: string) => apiBlob(`/lab-orders/${id}/report`),
  reportFile: (id: string) => apiBlob(`/lab-orders/${id}/report-file`),
};
