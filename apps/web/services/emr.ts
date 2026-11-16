import type {
  AllergyKind,
  ClinicalEntryStatus,
  DiagnosisType,
  FamilyCondition,
  Icd10Code,
  MedicalRecord,
  PatientHistory,
  Severity,
} from '@medcore/types';
import { apiBlob, apiList, apiRequest, qs } from '@/lib/api-client';

type Correction = { supersedesId?: string; correctionReason?: string };
export type VitalsInput = Partial<
  Record<
    'systolicBp' | 'diastolicBp' | 'pulse' | 'temperatureC' | 'spo2' | 'heightCm' | 'weightKg',
    number
  >
> &
  Correction;
export type HistoryList = 'allergies' | 'medications' | 'vaccinations' | 'family-history';
export type HistoryInput =
  | ({ kind: AllergyKind; substance: string; reaction?: string; severity?: Severity } & Correction)
  | ({
      medicineName: string;
      dosage?: string;
      frequency?: string;
      startedOn?: string;
      endedOn?: string;
      notes?: string;
    } & Correction)
  | ({
      vaccineName: string;
      administeredOn: string;
      batchNumber: string;
      nextDueOn?: string;
    } & Correction)
  | ({
      condition: FamilyCondition;
      present: boolean;
      relation?: string;
      notes?: string;
    } & Correction);

const rec = (id: string, sub = '') => `/medical-records/record/${id}${sub}`;

export const emrApi = {
  start: (b: { appointmentId: string; chiefComplaint: string; presentingSymptoms?: string }) =>
    apiRequest<MedicalRecord>('/medical-records', { method: 'POST', json: b }),
  get: (id: string) => apiRequest<MedicalRecord>(rec(id)),
  chart: (patientId: string, page = 1) =>
    apiList<MedicalRecord>(`/medical-records/${patientId}${qs({ page, limit: 10 })}`),
  update: (
    id: string,
    b: { chiefComplaint?: string; presentingSymptoms?: string; treatmentPlan?: string },
  ) => apiRequest<MedicalRecord>(rec(id), { method: 'PATCH', json: b }),
  addEntry: (id: string, b: { body: string; amendsEntryId?: string; correctionReason?: string }) =>
    apiRequest<MedicalRecord>(rec(id, '/entries'), { method: 'POST', json: b }),
  addVitals: (id: string, b: VitalsInput) =>
    apiRequest<MedicalRecord>(rec(id, '/vitals'), { method: 'POST', json: b }),
  addDiagnosis: (
    id: string,
    b: { icd10Code?: string; description: string; type: DiagnosisType } & Correction,
  ) => apiRequest<MedicalRecord>(rec(id, '/diagnoses'), { method: 'POST', json: b }),
  upload: (id: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return apiRequest<MedicalRecord>(rec(id, '/files'), { method: 'POST', form: fd });
  },
  download: (fileId: string) => apiBlob(`/files/${fileId}`),
  history: (patientId: string) => apiRequest<PatientHistory>(`/patients/${patientId}/history`),
  addHistory: (patientId: string, list: HistoryList, b: HistoryInput) =>
    apiRequest<PatientHistory>(`/patients/${patientId}/${list}`, { method: 'POST', json: b }),
  setHistoryStatus: (
    patientId: string,
    list: HistoryList,
    entryId: string,
    status: Exclude<ClinicalEntryStatus, 'ACTIVE'>,
    reason?: string,
  ) =>
    apiRequest<PatientHistory>(`/patients/${patientId}/${list}/${entryId}/status`, {
      method: 'PATCH',
      json: { status, ...(reason ? { reason } : {}) },
    }),
  icd10: (search: string) => apiRequest<Icd10Code[]>(`/icd10${qs({ search })}`),
};
