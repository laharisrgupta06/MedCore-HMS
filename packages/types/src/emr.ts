/** Phase 4 API contracts: electronic medical records (SCOPE-010/011, EMR-001..012). */

export const DIAGNOSIS_TYPES = ['DIFFERENTIAL', 'CONFIRMED'] as const;
export type DiagnosisType = (typeof DIAGNOSIS_TYPES)[number];
export const ALLERGY_KINDS = ['ALLERGY', 'ADVERSE_DRUG_REACTION'] as const;
export type AllergyKind = (typeof ALLERGY_KINDS)[number];
export const SEVERITIES = ['MILD', 'MODERATE', 'SEVERE'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const FAMILY_CONDITIONS = ['DIABETES', 'HYPERTENSION', 'CANCER', 'CARDIAC'] as const;
export type FamilyCondition = (typeof FAMILY_CONDITIONS)[number];
export const CLINICAL_ENTRY_STATUSES = ['ACTIVE', 'RESOLVED', 'ENTERED_IN_ERROR'] as const;
export type ClinicalEntryStatus = (typeof CLINICAL_ENTRY_STATUSES)[number];

/** Who wrote an entry and when (every clinical row keeps both; nothing is overwritten). */
export interface Authored {
  id: string;
  by: { id: string; firstName: string; lastName: string; role: string };
  at: string;
  /** Set when this row corrects an earlier one, which stays visible. */
  supersedesId: string | null;
  correctionReason: string | null;
  /** True when a later row corrects this one. */
  corrected: boolean;
}

export interface RecordEntry extends Authored {
  kind: 'NOTE' | 'ADDENDUM';
  body: string;
}

export interface Vitals extends Authored {
  systolicBp: number | null;
  diastolicBp: number | null;
  pulse: number | null;
  temperatureC: number | null;
  spo2: number | null;
  heightCm: number | null;
  weightKg: number | null;
  /** Calculated from height and weight when read (EMR-003); not stored. */
  bmi: number | null;
}

export interface Diagnosis extends Authored {
  icd10: { code: string; title: string } | null;
  description: string;
  type: DiagnosisType;
}

export interface ClinicalFile {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: { id: string; firstName: string; lastName: string };
  createdAt: string;
}

export interface MedicalRecord {
  id: string;
  status: 'OPEN' | 'CLOSED';
  chiefComplaint: string;
  presentingSymptoms: string | null;
  treatmentPlan: string | null;
  createdAt: string;
  closedAt: string | null;
  appointment: { id: string; scheduledAt: string; type: string; status: string };
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    mrn: string;
    dateOfBirth: string;
    gender: string;
  };
  doctor: {
    id: string;
    userId: string;
    firstName: string;
    lastName: string;
    specialisation: string;
  };
  department: { id: string; name: string };
  entries: RecordEntry[];
  vitals: Vitals[];
  diagnoses: Diagnosis[];
  files: ClinicalFile[];
}

export interface HistoryEntry extends Authored {
  status: ClinicalEntryStatus;
  statusReason: string | null;
  statusChangedAt: string | null;
}
export interface Allergy extends HistoryEntry {
  kind: AllergyKind;
  substance: string;
  reaction: string | null;
  severity: Severity | null;
}
export interface MedicationHistoryEntry extends HistoryEntry {
  medicineName: string;
  dosage: string | null;
  frequency: string | null;
  startedOn: string | null;
  endedOn: string | null;
  notes: string | null;
}
export interface Vaccination extends HistoryEntry {
  vaccineName: string;
  administeredOn: string;
  batchNumber: string;
  nextDueOn: string | null;
}
export interface FamilyHistoryEntry extends HistoryEntry {
  condition: FamilyCondition;
  present: boolean;
  relation: string | null;
  notes: string | null;
}

export interface PatientHistory {
  allergies: Allergy[];
  medications: MedicationHistoryEntry[];
  vaccinations: Vaccination[];
  familyHistory: FamilyHistoryEntry[];
}

export interface Icd10Code {
  code: string;
  title: string;
}

/** BMI (kg/m²) to one decimal; null when either value is missing (EMR-003). */
export function bmi(heightCm: number | null, weightKg: number | null): number | null {
  if (!heightCm || !weightKg) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

export const EmrErrorCode = {
  RECORD_EXISTS: 'RECORD_EXISTS',
  RECORD_CLOSED: 'RECORD_CLOSED',
  NOT_TREATING_DOCTOR: 'NOT_TREATING_DOCTOR',
  ALREADY_CORRECTED: 'ALREADY_CORRECTED',
  FILE_REJECTED: 'FILE_REJECTED',
} as const;

export const MAX_CLINICAL_FILE_BYTES = 20 * 1024 * 1024;
