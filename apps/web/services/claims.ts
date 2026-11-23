import type { ClaimStatus, ClaimView, CreateClaimRequest } from '@medcore/types';
import { apiRequest, qs } from '@/lib/api-client';

/** Insurance claims through a TPA (PRD 7.7). Settlements are tracked here until M-13 posts them to the balance. */
export const claimsApi = {
  forInvoice: (invoiceId: string) => apiRequest<ClaimView[]>(`/invoices/${invoiceId}/claims`),
  create: (invoiceId: string, b: CreateClaimRequest) =>
    apiRequest<ClaimView>(`/invoices/${invoiceId}/claims`, { method: 'POST', json: b }),
  list: (status?: ClaimStatus) => apiRequest<ClaimView[]>(`/claims${qs({ status })}`),
  decide: (id: string, decision: 'APPROVED' | 'REJECTED') =>
    apiRequest<ClaimView>(`/claims/${id}/decision`, { method: 'PATCH', json: { decision } }),
  settle: (id: string, settledAmount: string, postToBalance = false) =>
    apiRequest<ClaimView>(`/claims/${id}/settle`, {
      method: 'POST',
      json: { settledAmount, ...(postToBalance ? { postToBalance } : {}) },
    }),
};
