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

export const PRESCRIPTION_EVENT_KINDS = [
  'ISSUED',
  'VERIFIED',
  'DISPENSED',
  'HANDED_OVER',
  'CANCELLED',
  'BASELINE',
] as const;
export type PrescriptionEventKind = (typeof PRESCRIPTION_EVENT_KINDS)[number];

/** M-10: one append-only step of a prescription's history; BASELINE marks where recording began. */
export interface PrescriptionEvent {
  kind: PrescriptionEventKind;
  /** The prescription's status after this step. */
  status: PrescriptionStatus;
  occurredAt: string;
  actor: { firstName: string; lastName: string } | null;
  reason: string | null;
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
  verifiedBy: { firstName: string; lastName: string } | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  /** Oldest first. */
  history: PrescriptionEvent[];
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

// ---- Phase 7: pharmacy and inventory (SCOPE-014, PHARM-001..006) ----------------------------

/** PHARM-003 (owner decision 23:17): low means strictly below the reorder level. */
export function isLowStock(available: number, reorderLevel: number): boolean {
  return available < reorderLevel;
}

export const BATCH_STATUSES = ['ACTIVE', 'QUARANTINED', 'DEPLETED'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];
export const STOCK_MOVEMENT_TYPES = ['RECEIPT', 'DISPENSE', 'ADJUSTMENT', 'QUARANTINE'] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

/** Days ahead covered by the expiry report and the "expiring soon" alerts (PHARM-005). */
export const EXPIRY_WINDOW_DAYS = 30;

/** Adds days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * A batch expiring on `today` (hospital-local date) is already expired from the start of that day
 * (approved plan, section 6), so only batches with a later expiry date can be dispensed.
 */
export function isExpired(expiresOn: string, today: string): boolean {
  return expiresOn <= today;
}

/** Expiring within the window: not expired yet and expiry no later than today + 30 days. */
export function isExpiringSoon(expiresOn: string, today: string): boolean {
  return !isExpired(expiresOn, today) && expiresOn <= addDays(today, EXPIRY_WINDOW_DAYS);
}

export interface StockBatch {
  id: string;
  medicineId: string;
  batchNumber: string;
  manufacturedOn: string;
  expiresOn: string;
  quantity: number;
  unitCost: string;
  mrp: string;
  status: BatchStatus;
  receivedAt: string;
  /** Expired by the hospital-local date (counts as unusable even before the nightly run). */
  expired: boolean;
}

type FifoBatch = Pick<StockBatch, 'id' | 'quantity' | 'expiresOn' | 'receivedAt' | 'status'>;

/** FIFO order (PHARM-002): earliest expiry first, then earliest receipt. */
export function fifoOrder<T extends Pick<FifoBatch, 'expiresOn' | 'receivedAt'>>(
  batches: T[],
): T[] {
  return [...batches].sort(
    (a, b) => a.expiresOn.localeCompare(b.expiresOn) || a.receivedAt.localeCompare(b.receivedAt),
  );
}

/**
 * Which batches a dispense of `quantity` takes (PHARM-002/004): active, unexpired batches with
 * stock, in FIFO order. `short` is how many units are missing; 0 means the whole amount is covered.
 * The server runs this inside the dispensing transaction; the web shows it as a preview.
 */
export function allocateFifo(
  batches: FifoBatch[],
  quantity: number,
  today: string,
): { allocations: { batchId: string; quantity: number }[]; short: number } {
  const allocations: { batchId: string; quantity: number }[] = [];
  let left = quantity;
  for (const b of fifoOrder(batches)) {
    if (left <= 0) break;
    if (b.status !== 'ACTIVE' || b.quantity <= 0 || isExpired(b.expiresOn, today)) continue;
    const take = Math.min(left, b.quantity);
    allocations.push({ batchId: b.id, quantity: take });
    left -= take;
  }
  return { allocations, short: left };
}

/**
 * Stock accounting (DEC-043). A batch's `quantity` is the physical count on hand.
 * - RECEIPT adds, DISPENSE subtracts, ADJUSTMENT corrects the count: these change `quantity`.
 * - QUARANTINE changes the batch status only. Its figure records how many physical units were set
 *   aside at that moment; it is not a change and is excluded from the balance, so the units are
 *   neither double-counted nor silently removed. Destroying quarantined stock is a separate,
 *   reasoned ADJUSTMENT.
 * - Invariant: ledgerBalance(movements of a batch) === batch.quantity, before and after quarantine.
 * - Available stock counts ACTIVE, unexpired batches only, so quarantined or expired units are on
 *   hand but never available.
 */
export function ledgerBalance(movements: Pick<StockMovementView, 'type' | 'quantity'>[]): number {
  return movements.reduce((sum, m) => (m.type === 'QUARANTINE' ? sum : sum + m.quantity), 0);
}

/** Units that can be dispensed today: ACTIVE, unexpired batches (PHARM-004; same rule as the API). */
export function availableUnits(
  batches: Pick<StockBatch, 'status' | 'quantity' | 'expiresOn'>[],
  today: string,
): number {
  return batches
    .filter((b) => b.status === 'ACTIVE' && !isExpired(b.expiresOn, today))
    .reduce((sum, b) => sum + b.quantity, 0);
}

export interface StockMovementView {
  id: string;
  type: StockMovementType;
  /** Signed change to the batch quantity; for QUARANTINE, the units set aside (no change). */
  quantity: number;
  reason: string | null;
  createdAt: string;
  batch: { id: string; batchNumber: string; expiresOn: string };
  medicine: { id: string; name: string; strength: string };
  /** Null for automatic quarantine by the nightly expiry run. */
  performedBy: { id: string; firstName: string; lastName: string } | null;
  dispenseId: string | null;
}

export interface ExpiryReportItem {
  batchId: string;
  medicineId: string;
  medicineName: string;
  strength: string;
  batchNumber: string;
  expiresOn: string;
  quantity: number;
  kind: 'EXPIRING' | 'QUARANTINED';
}

export interface ExpiryReport {
  id: string;
  runDate: string;
  createdAt: string;
  items: ExpiryReportItem[];
}

export interface PharmacyAlerts {
  lowStock: (Pick<Medicine, 'id' | 'name' | 'strength' | 'form' | 'reorderLevel' | 'available'> & {
    lowStockSince: string;
  })[];
  expiringSoon: (Pick<StockBatch, 'id' | 'batchNumber' | 'expiresOn' | 'quantity'> & {
    medicine: { id: string; name: string; strength: string };
  })[];
  latestReport: ExpiryReport | null;
}

export interface DispenseRequest {
  items: { itemId: string; quantity: number }[];
}

export const PharmacyErrorCode = {
  MEDICINE_EXPIRED: 'MEDICINE_EXPIRED',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  NOT_VERIFIED: 'NOT_VERIFIED',
  EXCEEDS_PRESCRIBED: 'EXCEEDS_PRESCRIBED',
  NEGATIVE_STOCK: 'NEGATIVE_STOCK',
  EXPIRY_IN_PAST: 'EXPIRY_IN_PAST',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
} as const;
