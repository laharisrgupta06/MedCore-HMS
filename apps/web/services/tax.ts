import type {
  CreateTaxClassificationRequest,
  GstRegistrationRequest,
  TaxDefaultKind,
  TaxSettings,
  TaxVersionRequest,
  UpdateTaxClassificationRequest,
} from '@medcore/types';
import { apiRequest } from '@/lib/api-client';

/** Hospital tax settings (BILL-008, task 8-B2). Every rule is enforced by the API and database. */
export const taxApi = {
  settings: () => apiRequest<TaxSettings>('/tax/settings'),
  createClassification: (b: CreateTaxClassificationRequest) =>
    apiRequest<{ id: string }>('/tax/classifications', { method: 'POST', json: b }),
  updateClassification: (id: string, b: UpdateTaxClassificationRequest) =>
    apiRequest<{ id: string }>(`/tax/classifications/${id}`, { method: 'PATCH', json: b }),
  addVersion: (classificationId: string, b: TaxVersionRequest) =>
    apiRequest<{ id: string }>(`/tax/classifications/${classificationId}/versions`, {
      method: 'POST',
      json: b,
    }),
  updateVersion: (id: string, b: Partial<TaxVersionRequest>) =>
    apiRequest<{ id: string }>(`/tax/versions/${id}`, { method: 'PATCH', json: b }),
  deleteVersion: (id: string) => apiRequest<void>(`/tax/versions/${id}`, { method: 'DELETE' }),
  setDefault: (kind: TaxDefaultKind, classificationId: string) =>
    apiRequest<void>(`/tax/defaults/${kind}`, { method: 'PUT', json: { classificationId } }),
  addRegistration: (b: GstRegistrationRequest) =>
    apiRequest<{ id: string }>('/tax/registrations', { method: 'POST', json: b }),
  deleteRegistration: (id: string) =>
    apiRequest<void>(`/tax/registrations/${id}`, { method: 'DELETE' }),
  confirm: () => apiRequest<{ setupConfirmedAt: string }>('/tax/confirm', { method: 'POST' }),
  assign: (item: 'lab-tests' | 'medicines', id: string, classificationId: string | null) =>
    apiRequest<void>(`/tax/assignments/${item}/${id}`, {
      method: 'PUT',
      json: { classificationId },
    }),
};
