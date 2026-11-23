import type {
  AddLineRequest,
  ChargeOptions,
  CorrectionRequestKind,
  InvoiceStatus,
  InvoiceSummary,
  InvoiceView,
} from '@medcore/types';
import { apiList, apiRequest, qs } from '@/lib/api-client';

/** Invoices (BILL-001..003). Every rule is enforced again by the API and the database (M-11b). */
export const invoicesApi = {
  list: (q: { status?: InvoiceStatus; patientId?: string; page?: number; limit?: number }) =>
    apiList<InvoiceSummary>(`/invoices${qs(q)}`),
  get: (id: string) => apiRequest<InvoiceView>(`/invoices/${id}`),
  options: () => apiRequest<ChargeOptions>('/invoices/options'),
  create: (appointmentId: string) =>
    apiRequest<InvoiceView>('/invoices', { method: 'POST', json: { appointmentId } }),
  lateCharges: (id: string) =>
    apiRequest<InvoiceView>(`/invoices/${id}/late-charges`, { method: 'POST' }),
  addLine: (id: string, b: AddLineRequest) =>
    apiRequest<InvoiceView>(`/invoices/${id}/items`, { method: 'POST', json: b }),
  removeLine: (id: string, itemId: string) =>
    apiRequest<InvoiceView>(`/invoices/${id}/items/${itemId}`, { method: 'DELETE' }),
  reresolve: (id: string) =>
    apiRequest<InvoiceView>(`/invoices/${id}/reresolve-tax`, { method: 'POST' }),
  discount: (id: string, amount: string, reason?: string) =>
    apiRequest<InvoiceView>(`/invoices/${id}/discount`, {
      method: 'PATCH',
      json: { amount, ...(reason ? { reason } : {}) },
    }),
  finalise: (id: string) =>
    apiRequest<InvoiceView>(`/invoices/${id}/finalise`, { method: 'PATCH' }),
  void: (id: string, reason: string) =>
    apiRequest<InvoiceView>(`/invoices/${id}/void`, { method: 'PATCH', json: { reason } }),
  requestCorrection: (id: string, kind: CorrectionRequestKind, description: string) =>
    apiRequest<{ message: string; invoice: InvoiceView }>(`/invoices/${id}/correction-requests`, {
      method: 'POST',
      json: { kind, description },
    }),
  addNote: (id: string, requestId: string, note: string, externalReference?: string) =>
    apiRequest<InvoiceView>(`/invoices/${id}/correction-requests/${requestId}/notes`, {
      method: 'POST',
      json: { note, ...(externalReference ? { externalReference } : {}) },
    }),
};
