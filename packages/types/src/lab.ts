/** Phase 6 laboratory contracts (SCOPE-013, LAB-001..007, API-022/023, DEC-040 D7/D8). */

export const LAB_TEST_CATEGORIES = ['LABORATORY', 'RADIOLOGY'] as const;
export type LabTestCategory = (typeof LAB_TEST_CATEGORIES)[number];
export const LAB_ORDER_STATUSES = [
  'ORDERED',
  'SAMPLE_COLLECTED',
  'PROCESSING',
  'RESULT_UPLOADED',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;
export type LabOrderStatus = (typeof LAB_ORDER_STATUSES)[number];
export const LAB_PRIORITIES = ['ROUTINE', 'URGENT'] as const;
export type LabPriority = (typeof LAB_PRIORITIES)[number];
export type ResultFlag = 'NORMAL' | 'LOW' | 'HIGH';
export type RangeGender = 'FEMALE' | 'MALE' | 'OTHER' | 'UNDISCLOSED';

export interface LabRange {
  gender: RangeGender | null;
  ageMinYears: number | null;
  ageMaxYears: number | null;
  low: number;
  high: number;
}

export interface LabTest {
  id: string;
  code: string;
  name: string;
  category: LabTestCategory;
  unit: string | null;
  sampleType: string | null;
  price: string;
  isActive: boolean;
  /** Tax classification for billing (BILL-008); null means the hospital's lab default. */
  taxClassificationId: string | null;
  ranges: LabRange[];
}

export interface LabResult {
  valueNumeric: number | null;
  valueText: string | null;
  flag: ResultFlag | null;
  unit: string | null;
  referenceLow: number | null;
  referenceHigh: number | null;
  enteredBy: { id: string; firstName: string; lastName: string };
  enteredAt: string;
}

export interface LabOrderItem {
  id: string;
  test: Pick<LabTest, 'id' | 'code' | 'name' | 'category' | 'unit' | 'sampleType'>;
  /** Null when not entered yet, or hidden from this reader until approval (LAB-005). */
  result: LabResult | null;
}

type Person = { id: string; firstName: string; lastName: string };

export interface LabOrder {
  id: string;
  status: LabOrderStatus;
  priority: LabPriority;
  clinicalNotes: string | null;
  createdAt: string;
  medicalRecordId: string;
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    mrn: string;
    dateOfBirth: string;
    gender: RangeGender;
  };
  orderedBy: Person;
  sampleCollectedAt: string | null;
  sampleCollectedBy: Person | null;
  approvedAt: string | null;
  approvedBy: Person | null;
  rejectedAt: string | null;
  rejectedBy: Person | null;
  rejectionReason: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  amendsLabOrderId: string | null;
  amendmentReason: string | null;
  hasReportFile: boolean;
  /** False when values are withheld from this reader (doctors, nurses and patients see them once APPROVED). */
  resultsVisible: boolean;
  items: LabOrderItem[];
}

/**
 * The most specific range that applies to the patient (LAB-006): gender and age band both count;
 * ranges without a condition apply to everyone. Null when none applies.
 */
export function selectRange(
  ranges: LabRange[],
  gender: RangeGender,
  ageYears: number,
): LabRange | null {
  let best: LabRange | null = null;
  let bestScore = -1;
  for (const r of ranges) {
    if (r.gender && r.gender !== gender) continue;
    if (r.ageMinYears != null && ageYears < r.ageMinYears) continue;
    if (r.ageMaxYears != null && ageYears > r.ageMaxYears) continue;
    const score = (r.gender ? 1 : 0) + (r.ageMinYears != null || r.ageMaxYears != null ? 1 : 0);
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

/** A value equal to a limit is NORMAL. */
export function flagFor(
  value: number,
  range: Pick<LabRange, 'low' | 'high'> | null,
): ResultFlag | null {
  if (!range) return null;
  return value < range.low ? 'LOW' : value > range.high ? 'HIGH' : 'NORMAL';
}

/** Whole years between a date of birth and an instant. */
export function ageInYears(dateOfBirth: string, at: Date = new Date()): number {
  const d = new Date(`${dateOfBirth.slice(0, 10)}T00:00:00Z`);
  let age = at.getUTCFullYear() - d.getUTCFullYear();
  if (
    at.getUTCMonth() < d.getUTCMonth() ||
    (at.getUTCMonth() === d.getUTCMonth() && at.getUTCDate() < d.getUTCDate())
  )
    age--;
  return age;
}

export const LabErrorCode = {
  SELF_APPROVAL: 'SELF_APPROVAL',
  NOT_SENIOR: 'NOT_SENIOR',
  NOT_APPROVED: 'NOT_APPROVED',
  RESULTS_INCOMPLETE: 'RESULTS_INCOMPLETE',
} as const;
