/** Insurance claims through a third-party administrator (PRD 7.7). Tracking only; see M-13 for settlement into the balance. */
export const CLAIM_STATUSES = ['SUBMITTED', 'APPROVED', 'REJECTED', 'SETTLED'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SETTLED: 'Settled',
};

export interface ClaimView {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  patientName: string;
  tpaName: string;
  policyNumber: string;
  claimAmount: string;
  status: ClaimStatus;
  settledAmount: string | null;
  notes: string | null;
  submittedAt: string;
  decidedAt: string | null;
}

export interface CreateClaimRequest {
  tpaName: string;
  policyNumber: string;
  claimAmount: string;
  notes?: string;
}

export interface ClaimDecisionRequest {
  decision: 'APPROVED' | 'REJECTED';
}

export interface SettleClaimRequest {
  settledAmount: string;
  /** Also post to the invoice balance as a TPA payment (needs M-12 and M-13). */
  postToBalance?: boolean;
}
