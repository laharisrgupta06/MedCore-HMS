/** Shared catalogue and prescription contracts (Phase 5; SCOPE-012, RX-001..008, API-020/021/024). */

export const MEDICINE_FORMS = ['TABLET', 'CAPSULE', 'SYRUP', 'INJECTION', 'TOPICAL'] as const;
export type MedicineForm = (typeof MEDICINE_FORMS)[number];
export const DOSE_FREQUENCIES = ['OD', 'BD', 'TDS', 'QID', 'SOS'] as const;
export type DoseFrequency = (typeof DOSE_FREQUENCIES)[number];
/** Doses per day for quantity suggestions; SOS (as needed) has no fixed count. */
export const DOSES_PER_DAY: Record<DoseFrequency, number | null> = {
  OD: 1,
  BD: 2,
  TDS: 3,
  QID: 4,
  SOS: null,
};
export const FREQUENCY_LABEL: Record<DoseFrequency, string> = {
  OD: 'Once a day',
  BD: 'Twice a day',
  TDS: 'Three times a day',
  QID: 'Four times a day',
  SOS: 'When needed',
};

export interface Medicine {
  id: string;
  name: string;
  genericName: string | null;
  form: MedicineForm;
  strength: string;
  reorderLevel: number;
  isActive: boolean;
  /** Units in active, unexpired batches (cached up to 60 s, CACHE-002). */
  available: number;
}

export const PRESCRIPTION_STATUSES = [
  'ISSUED',
  'READY_FOR_PICKUP',
  'PARTIALLY_DISPENSED',
  'DISPENSED',
  'CANCELLED',
] as const;
export type PrescriptionStatus = (typeof PRESCRIPTION_STATUSES)[number];

export interface PrescriptionItem {
  id: string;
  medicine: Pick<Medicine, 'id' | 'name' | 'genericName' | 'form' | 'strength'>;
  dosage: string;
  frequency: DoseFrequency;
  durationDays: number;
  quantity: number;
  instructions: string | null;
  dispensedQuantity: number;
}

export interface Prescription {
  id: string;
  status: PrescriptionStatus;
  issuedAt: string;
  notes: string | null;
  medicalRecordId: string;
  patient: { id: string; firstName: string; lastName: string; mrn: string };
  doctor: {
    id: string;
    userId: string;
    firstName: string;
    lastName: string;
    specialisation: string;
  };
  items: PrescriptionItem[];
  allergyOverrideReason: string | null;
  pdfReady: boolean;
  verifiedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
}

export interface IssuePrescriptionRequest {
  medicalRecordId: string;
  items: {
    medicineId: string;
    dosage: string;
    frequency: DoseFrequency;
    durationDays: number;
    quantity: number;
    instructions?: string;
  }[];
  notes?: string;
  /** Required when the patient has a matching active allergy (409 ALLERGY_CONFLICT otherwise). */
  allergyOverrideReason?: string;
}

export interface AllergyConflict {
  allergyId: string;
  substance: string;
  medicineId: string;
  medicineName: string;
}

/** Suggested quantity: doses per day × days (SOS has no suggestion). */
export function suggestedQuantity(frequency: DoseFrequency, days: number): number | null {
  const perDay = DOSES_PER_DAY[frequency];
  return perDay && days > 0 ? perDay * days : null;
}

export const PrescriptionErrorCode = {
  ALLERGY_CONFLICT: 'ALLERGY_CONFLICT',
  NO_SIGNATURE: 'NO_SIGNATURE',
  ALREADY_DISPENSED: 'ALREADY_DISPENSED',
  PDF_PENDING: 'PDF_PENDING',
  PDF_READY: 'PDF_READY',
} as const;
