import type { InvoiceLineKind } from './invoice-snapshot';
import type {
  GstRegistrationType,
  TaxNotCollectedReason,
  TaxSupplyType,
  TaxTreatment,
} from './billing';

/** Invoices (BILL-001..003, task 8-B3). Amounts are decimal strings in rupees. */
export const INVOICE_STATUSES = ['DRAFT', 'FINALISED', 'PARTIALLY_PAID', 'PAID', 'VOID'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export type InvoiceKind = 'ORIGINAL' | 'LATE_CHARGES';
export type DocumentType = 'TAX_INVOICE' | 'INVOICE_CUM_BILL_OF_SUPPLY' | 'BILL_OF_SUPPLY';
export const CORRECTION_REQUEST_KINDS = [
  'CANCEL_DOCUMENT',
  'CHANGE_AMOUNTS',
  'WRONG_PATIENT',
  'WRONG_DETAILS',
] as const;
export type CorrectionRequestKind = (typeof CORRECTION_REQUEST_KINDS)[number];

export interface InvoiceLineView {
  id: string;
  kind: InvoiceLineKind;
  description: string;
  quantity: number;
  unitPrice: string;
  serviceDate: string;
  unclassified: boolean;
  classificationName: string | null;
  hsnSac: string | null;
  supplyType: TaxSupplyType | null;
  treatment: TaxTreatment | null;
  ratePercent: string | null;
  priceIncludesTax: boolean | null;
  gstCollected: boolean;
  notCollectedReason: TaxNotCollectedReason | null;
  grossAmount: string;
  discountShare: string;
  taxableValue: string;
  taxAmount: string;
  lineTotal: string;
  /** Set when the line's draft was voided: the charge was released for a replacement draft. */
  releasedAt: string | null;
  /** Manual lines (room, other) can be removed from a draft; automatic lines follow their source. */
  manual: boolean;
}

export interface InvoiceEventView {
  kind: 'CREATED' | 'DISCOUNT_CHANGED' | 'FINALISED' | 'VOIDED' | 'CORRECTION_REQUESTED';
  actorName: string;
  note: string | null;
  createdAt: string;
}

export interface CorrectionRequestView {
  id: string;
  kind: CorrectionRequestKind;
  description: string;
  requestedByName: string;
  createdAt: string;
  notes: {
    note: string;
    externalReference: string | null;
    authorName: string;
    createdAt: string;
  }[];
}

export interface InvoiceSummary {
  id: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  invoiceNumber: string | null;
  documentType: DocumentType | null;
  issueDate: string | null;
  total: string;
  patient: { id: string; name: string; mrn: string };
  appointment: { id: string; scheduledAt: string; doctorName: string };
  createdAt: string;
}

export interface InvoiceView extends InvoiceSummary {
  sequence: number;
  relatedInvoiceId: string | null;
  lateChargeInvoiceIds: string[];
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  discountReason: string | null;
  voidReason: string | null;
  voidedAt: string | null;
  finalisedAt: string | null;
  seller: {
    registrationType: GstRegistrationType;
    gstin: string | null;
    legalName: string | null;
    stateCode: string | null;
  } | null;
  lines: InvoiceLineView[];
  /** Staff only (empty for patients). */
  events: InvoiceEventView[];
  correctionRequests: CorrectionRequestView[];
  /** Why it cannot be finalised yet (drafts, staff only); empty when it can. */
  finaliseBlockers: string[];
}

export interface AddRoomLineRequest {
  kind: 'ROOM';
  roomId: string;
  days: number;
  serviceDate: string;
}
export interface AddOtherLineRequest {
  kind: 'OTHER';
  description: string;
  classificationId: string;
  unitPrice: string;
  quantity: number;
  serviceDate: string;
}
export type AddLineRequest = AddRoomLineRequest | AddOtherLineRequest;

export interface ChargeOptions {
  classifications: { id: string; name: string; supplyType: 'GOODS' | 'SERVICE'; hsnSac: string }[];
  rooms: { id: string; number: string; type: string; dailyCharge: string }[];
}
