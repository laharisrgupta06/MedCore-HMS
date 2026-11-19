import type { CriticalCareUnit, GstRegistrationType, TaxSupplyType, TaxTreatment } from './billing';

/** Tax settings of one hospital (BILL-008, DEC-045 to DEC-059). Amounts and rates are decimal strings. */
export interface TaxClassificationVersionView {
  id: string;
  treatment: TaxTreatment;
  ratePercent: string;
  priceIncludesTax: boolean;
  effectiveFrom: string;
  /** In force today (the latest start on or before the hospital's tax date). */
  inForce: boolean;
  /** Not yet in force: may be corrected or withdrawn (DEC-059). */
  editable: boolean;
}

export interface TaxClassificationView {
  id: string;
  name: string;
  supplyType: TaxSupplyType;
  hsnSac: string;
  isActive: boolean;
  usedAsDefault: boolean;
  versions: TaxClassificationVersionView[];
}

export interface GstRegistrationView {
  id: string;
  registrationType: GstRegistrationType;
  gstin: string | null;
  legalName: string | null;
  stateCode: string | null;
  effectiveFrom: string;
  inForce: boolean;
  deletable: boolean;
}

export interface StatutoryRoomRuleView {
  effectiveFrom: string;
  thresholdPerDay: string;
  ratePercent: string;
  sacCode: string;
  legalReference: string;
}

export type TaxDefaultKind = 'CONSULTATION' | 'LAB';
export const TAX_DEFAULT_KINDS: readonly TaxDefaultKind[] = ['CONSULTATION', 'LAB'];

export interface TaxSettings {
  /** The hospital's local date used for effective dates (ten minutes ahead of now, DEC-058). */
  taxDate: string;
  timezone: string;
  timezoneLocked: boolean;
  setupConfirmedAt: string | null;
  classifications: TaxClassificationView[];
  defaults: { kind: TaxDefaultKind; classificationId: string }[];
  registrations: GstRegistrationView[];
  roomRules: StatutoryRoomRuleView[];
}

export interface CreateTaxClassificationRequest {
  name: string;
  supplyType: TaxSupplyType;
  hsnSac: string;
}
export interface UpdateTaxClassificationRequest {
  name?: string;
  isActive?: boolean;
}
export interface TaxVersionRequest {
  treatment: TaxTreatment;
  ratePercent: string;
  priceIncludesTax: boolean;
  effectiveFrom: string;
}
export interface GstRegistrationRequest {
  registrationType: GstRegistrationType;
  gstin?: string;
  legalName?: string;
  effectiveFrom: string;
}

export const TaxErrorCode = {
  TIMEZONE_LOCKED: 'TIMEZONE_LOCKED',
  GSTIN_INVALID: 'GSTIN_INVALID',
  GSTIN_UNAVAILABLE: 'GSTIN_UNAVAILABLE',
  HSN_SAC_INVALID: 'HSN_SAC_INVALID',
  RATE_INVALID: 'RATE_INVALID',
  RULE_VIOLATION: 'RULE_VIOLATION',
  CONCURRENT_UPDATE: 'CONCURRENT_UPDATE',
} as const;

export type { CriticalCareUnit };
