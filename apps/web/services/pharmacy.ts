import type {
  PharmacyAlerts,
  Prescription,
  PrescriptionStatus,
  StockBatch,
  StockMovementView,
} from '@medcore/types';
import { apiList, apiRequest, qs } from '@/lib/api-client';

export type ReceiveBatchInput = {
  batchNumber: string;
  manufacturedOn: string;
  expiresOn: string;
  quantity: number;
  unitCost: number;
  mrp: number;
};

export const pharmacyApi = {
  batches: (medicineId: string) => apiRequest<StockBatch[]>(`/medicines/${medicineId}/batches`),
  receive: (medicineId: string, b: ReceiveBatchInput) =>
    apiRequest<StockBatch>(`/medicines/${medicineId}/batches`, { method: 'POST', json: b }),
  quarantine: (batchId: string, reason: string) =>
    apiRequest<StockBatch>(`/batches/${batchId}/quarantine`, { method: 'PATCH', json: { reason } }),
  adjust: (batchId: string, quantity: number, reason: string) =>
    apiRequest<StockBatch>(`/batches/${batchId}/adjustments`, {
      method: 'POST',
      json: { quantity, reason },
    }),
  queue: (q: { status?: PrescriptionStatus; page?: number; limit?: number }) =>
    apiList<Prescription>(`/pharmacy/prescriptions${qs(q)}`),
  verify: (id: string) =>
    apiRequest<Prescription>(`/pharmacy/prescriptions/${id}/verify`, { method: 'PATCH', json: {} }),
  dispense: (id: string, items: { itemId: string; quantity: number }[]) =>
    apiRequest<Prescription>(`/pharmacy/prescriptions/${id}/dispense`, {
      method: 'POST',
      json: { items },
    }),
  handover: (id: string) =>
    apiRequest<Prescription>(`/pharmacy/prescriptions/${id}/handover`, {
      method: 'PATCH',
      json: {},
    }),
  alerts: () => apiRequest<PharmacyAlerts>('/pharmacy/alerts'),
  ledger: (q: {
    medicineId?: string;
    batchId?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) => apiList<StockMovementView>(`/pharmacy/ledger${qs(q)}`),
};
