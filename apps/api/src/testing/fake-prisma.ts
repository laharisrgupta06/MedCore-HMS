/**
 * In-memory stand-in for the subset of PrismaClient used by the auth and users modules, for unit
 * tests only. Supports equality / null / contains (insensitive) / in / OR / AND filters, ordering,
 * paging, the `include` relations the services use, query extensions ($extends with
 * $allModels.$allOperations, used by the tenant client) and the unique constraints the code relies
 * on (users.email, patients(hospitalId, mrn)). Real PostgreSQL behaviour is covered by the
 * integration tests (T-MIG-*, T-AUTH-INT-001 on macOS).
 */
import { randomUUID } from 'node:crypto';
import { localDate } from '../common/time/zoned';
import { Prisma, type AuditLog, type Hospital, type Patient, type User } from '@prisma/client';

type Row = Record<string, unknown>;
type Args = Record<string, unknown>;
type Hook = (p: {
  model: string;
  operation: string;
  args: Args;
  query: (a: Args) => Promise<unknown>;
}) => Promise<unknown>;

function unique(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

function notFound(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Record not found', {
    code: 'P2025',
    clientVersion: 'test',
  });
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

const WRITES = new Set([
  'create',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'createMany',
  'createManyAndReturn',
]);

function isPlain(v: unknown): v is Row {
  return typeof v === 'object' && v !== null && !(v instanceof Date) && !Array.isArray(v);
}

export function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === 'AND') return (cond as Row[]).every((w) => matches(row, w));
    if (key === 'OR') return (cond as Row[]).some((w) => matches(row, w));
    if (key === 'NOT') return !matches(row, cond as Row);
    const value = row[key];
    if (isPlain(cond)) {
      if ('contains' in cond) {
        const needle = String(cond.contains);
        const hay = String(value ?? '');
        return cond.mode === 'insensitive'
          ? hay.toLowerCase().includes(needle.toLowerCase())
          : hay.includes(needle);
      }
      if ('in' in cond) return (cond.in as unknown[]).some((v) => same(v, value));
      if ('gt' in cond || 'gte' in cond || 'lt' in cond || 'lte' in cond || 'startsWith' in cond) {
        const num = (v: unknown) => (v instanceof Date ? v.getTime() : (v as number));
        if (value == null) return false;
        if ('startsWith' in cond && !String(value).startsWith(String(cond.startsWith)))
          return false;
        if ('gt' in cond && !(num(value) > num(cond.gt))) return false;
        if ('gte' in cond && !(num(value) >= num(cond.gte))) return false;
        if ('lt' in cond && !(num(value) < num(cond.lt))) return false;
        if ('lte' in cond && !(num(value) <= num(cond.lte))) return false;
        if ('not' in cond && same(cond.not, value)) return false;
        return true;
      }
      if ('equals' in cond) return same(cond.equals, value);
      if ('not' in cond) return !same(cond.not, value);
      // Compound unique selector such as { id_hospitalId: { id, hospitalId } }.
      return matches(row, cond);
    }
    return same(cond, value);
  });
}

function sortRows(rows: Row[], orderBy: unknown): Row[] {
  const orders = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Record<
    string,
    'asc' | 'desc'
  >[];
  return [...rows].sort((a, b) => {
    for (const o of orders) {
      const [k, dir] = Object.entries(o)[0]!;
      const av = String(a[k] ?? '');
      const bv = String(b[k] ?? '');
      if (av !== bv) return (av < bv ? -1 : 1) * (dir === 'desc' ? -1 : 1);
    }
    return 0;
  });
}

const MODEL_OF: Record<string, string> = {
  hospital: 'Hospital',
  user: 'User',
  patient: 'Patient',
  auditLog: 'AuditLog',
  department: 'Department',
  staffProfile: 'StaffProfile',
  doctor: 'Doctor',
  doctorDepartment: 'DoctorDepartment',
  room: 'Room',
  bed: 'Bed',
  fileAttachment: 'FileAttachment',
  doctorSchedule: 'DoctorSchedule',
  scheduleException: 'ScheduleException',
  appointment: 'Appointment',
  medicalRecord: 'MedicalRecord',
  recordEntry: 'RecordEntry',
  vitals: 'Vitals',
  diagnosis: 'Diagnosis',
  icd10Code: 'Icd10Code',
  allergy: 'Allergy',
  medicationHistory: 'MedicationHistory',
  vaccination: 'Vaccination',
  familyHistory: 'FamilyHistory',
  medicine: 'Medicine',
  medicineBatch: 'MedicineBatch',
  prescription: 'Prescription',
  prescriptionItem: 'PrescriptionItem',
  dispense: 'Dispense',
  stockMovement: 'StockMovement',
  expiryReport: 'ExpiryReport',
  prescriptionEvent: 'PrescriptionEvent',
  address: 'Address',
  labTest: 'LabTest',
  labTestRange: 'LabTestRange',
  labOrder: 'LabOrder',
  labOrderItem: 'LabOrderItem',
  labResult: 'LabResult',
  invoice: 'Invoice',
  payment: 'Payment',
  insuranceClaim: 'InsuranceClaim',
  webhookEvent: 'WebhookEvent',
  notification: 'Notification',
  notificationDelivery: 'NotificationDelivery',
};

interface Relation {
  model: string;
  local: string;
  foreign: string;
  many?: boolean;
}
/** The relations the services include, with their join columns. */
const RELATIONS: Record<string, Record<string, Relation>> = {
  User: {
    hospital: { model: 'Hospital', local: 'hospitalId', foreign: 'id' },
    patient: { model: 'Patient', local: 'id', foreign: 'userId' },
    staffProfile: { model: 'StaffProfile', local: 'id', foreign: 'userId' },
    doctor: { model: 'Doctor', local: 'id', foreign: 'userId' },
  },
  StaffProfile: {
    user: { model: 'User', local: 'userId', foreign: 'id' },
    department: { model: 'Department', local: 'departmentId', foreign: 'id' },
  },
  Doctor: {
    user: { model: 'User', local: 'userId', foreign: 'id' },
    departments: { model: 'DoctorDepartment', local: 'id', foreign: 'doctorId', many: true },
  },
  DoctorDepartment: { department: { model: 'Department', local: 'departmentId', foreign: 'id' } },
  Patient: { user: { model: 'User', local: 'userId', foreign: 'id' } },
  Invoice: {
    patient: { model: 'Patient', local: 'patientId', foreign: 'id' },
    payments: { model: 'Payment', local: 'id', foreign: 'invoiceId', many: true },
  },
  Payment: {
    invoice: { model: 'Invoice', local: 'invoiceId', foreign: 'id' },
    receivedBy: { model: 'User', local: 'receivedById', foreign: 'id' },
    reconciledBy: { model: 'User', local: 'reconciledById', foreign: 'id' },
  },
  InsuranceClaim: { invoice: { model: 'Invoice', local: 'invoiceId', foreign: 'id' } },
  Room: {
    beds: { model: 'Bed', local: 'id', foreign: 'roomId', many: true },
    department: { model: 'Department', local: 'departmentId', foreign: 'id' },
  },
  Bed: { room: { model: 'Room', local: 'roomId', foreign: 'id' } },
  Appointment: {
    hospital: { model: 'Hospital', local: 'hospitalId', foreign: 'id' },
    doctor: { model: 'Doctor', local: 'doctorId', foreign: 'id' },
    patient: { model: 'Patient', local: 'patientId', foreign: 'id' },
    department: { model: 'Department', local: 'departmentId', foreign: 'id' },
    medicalRecord: { model: 'MedicalRecord', local: 'id', foreign: 'appointmentId' },
  },
  DoctorSchedule: { doctor: { model: 'Doctor', local: 'doctorId', foreign: 'id' } },
  MedicalRecord: {
    appointment: { model: 'Appointment', local: 'appointmentId', foreign: 'id' },
    entries: { model: 'RecordEntry', local: 'id', foreign: 'medicalRecordId', many: true },
    vitals: { model: 'Vitals', local: 'id', foreign: 'medicalRecordId', many: true },
    diagnoses: { model: 'Diagnosis', local: 'id', foreign: 'medicalRecordId', many: true },
    files: { model: 'FileAttachment', local: 'id', foreign: 'medicalRecordId', many: true },
  },
  RecordEntry: { author: { model: 'User', local: 'authorId', foreign: 'id' } },
  Vitals: { recordedBy: { model: 'User', local: 'recordedById', foreign: 'id' } },
  Diagnosis: {
    recordedBy: { model: 'User', local: 'recordedById', foreign: 'id' },
    icd10: { model: 'Icd10Code', local: 'icd10Code', foreign: 'code' },
  },
  Allergy: { recordedBy: { model: 'User', local: 'recordedById', foreign: 'id' } },
  MedicationHistory: { recordedBy: { model: 'User', local: 'recordedById', foreign: 'id' } },
  Vaccination: { recordedBy: { model: 'User', local: 'recordedById', foreign: 'id' } },
  FamilyHistory: { recordedBy: { model: 'User', local: 'recordedById', foreign: 'id' } },
  FileAttachment: { uploadedBy: { model: 'User', local: 'uploadedById', foreign: 'id' } },
  Hospital: { address: { model: 'Address', local: 'addressId', foreign: 'id' } },
  Prescription: {
    hospital: { model: 'Hospital', local: 'hospitalId', foreign: 'id' },
    medicalRecord: { model: 'MedicalRecord', local: 'medicalRecordId', foreign: 'id' },
    items: { model: 'PrescriptionItem', local: 'id', foreign: 'prescriptionId', many: true },
    verifiedBy: { model: 'User', local: 'verifiedById', foreign: 'id' },
    events: { model: 'PrescriptionEvent', local: 'id', foreign: 'prescriptionId', many: true },
  },
  PrescriptionEvent: {
    actor: { model: 'User', local: 'actorId', foreign: 'id' },
    prescription: { model: 'Prescription', local: 'prescriptionId', foreign: 'id' },
  },
  PrescriptionItem: {
    prescription: { model: 'Prescription', local: 'prescriptionId', foreign: 'id' },
    medicine: { model: 'Medicine', local: 'medicineId', foreign: 'id' },
    dispenses: { model: 'Dispense', local: 'id', foreign: 'prescriptionItemId', many: true },
  },
  Dispense: {
    prescriptionItem: { model: 'PrescriptionItem', local: 'prescriptionItemId', foreign: 'id' },
    batch: { model: 'MedicineBatch', local: 'batchId', foreign: 'id' },
    dispensedBy: { model: 'User', local: 'dispensedById', foreign: 'id' },
  },
  MedicineBatch: {
    medicine: { model: 'Medicine', local: 'medicineId', foreign: 'id' },
    stockMovements: { model: 'StockMovement', local: 'id', foreign: 'batchId', many: true },
  },
  Medicine: { batches: { model: 'MedicineBatch', local: 'id', foreign: 'medicineId', many: true } },
  StockMovement: {
    batch: { model: 'MedicineBatch', local: 'batchId', foreign: 'id' },
    performedBy: { model: 'User', local: 'performedById', foreign: 'id' },
    dispense: { model: 'Dispense', local: 'dispenseId', foreign: 'id' },
    expiryReport: { model: 'ExpiryReport', local: 'expiryReportId', foreign: 'id' },
  },
  LabTest: { ranges: { model: 'LabTestRange', local: 'id', foreign: 'labTestId', many: true } },
  LabOrder: {
    medicalRecord: { model: 'MedicalRecord', local: 'medicalRecordId', foreign: 'id' },
    orderedBy: { model: 'User', local: 'orderedById', foreign: 'id' },
    sampleCollectedBy: { model: 'User', local: 'sampleCollectedById', foreign: 'id' },
    approvedBy: { model: 'User', local: 'approvedById', foreign: 'id' },
    rejectedBy: { model: 'User', local: 'rejectedById', foreign: 'id' },
    items: { model: 'LabOrderItem', local: 'id', foreign: 'labOrderId', many: true },
  },
  LabOrderItem: {
    labTest: { model: 'LabTest', local: 'labTestId', foreign: 'id' },
    result: { model: 'LabResult', local: 'id', foreign: 'labOrderItemId' },
    labOrder: { model: 'LabOrder', local: 'labOrderId', foreign: 'id' },
  },
  LabResult: { enteredBy: { model: 'User', local: 'enteredById', foreign: 'id' } },
};

/** Unique constraints mirrored from schema.prisma for the modelled tables. */
const UNIQUES: Record<string, string[][]> = {
  Department: [['hospitalId', 'name']],
  StaffProfile: [['userId'], ['hospitalId', 'employeeCode']],
  Doctor: [['userId']],
  DoctorDepartment: [['doctorId', 'departmentId']],
  Room: [['hospitalId', 'number']],
  Bed: [['roomId', 'label']],
  MedicalRecord: [['appointmentId']],
  RecordEntry: [['amendsEntryId']],
  Vitals: [['supersedesId']],
  Diagnosis: [['supersedesId']],
  Allergy: [['supersedesId']],
  MedicationHistory: [['supersedesId']],
  Vaccination: [['supersedesId']],
  FamilyHistory: [['supersedesId']],
  Medicine: [['hospitalId', 'name', 'strength', 'form']],
  MedicineBatch: [['medicineId', 'batchNumber']],
  StockMovement: [['dispenseId']],
  ExpiryReport: [['hospitalId', 'runDate']],
  PrescriptionItem: [['prescriptionId', 'medicineId']],
  LabTest: [['hospitalId', 'code']],
  LabOrderItem: [['labOrderId', 'labTestId']],
  LabResult: [['labOrderItemId']],
  LabOrder: [['amendsLabOrderId']],
  // M-15: one-time notifications; NULL keys never conflict, as in PostgreSQL.
  Notification: [['recipientId', 'dedupeKey']],
};

/** Rows that block deletion of a parent (ON DELETE RESTRICT in the database). */
const REFERENCES: Record<string, { model: string; column: string }[]> = {
  Department: [
    { model: 'StaffProfile', column: 'departmentId' },
    { model: 'DoctorDepartment', column: 'departmentId' },
    { model: 'Room', column: 'departmentId' },
    { model: 'Appointment', column: 'departmentId' },
  ],
  Room: [{ model: 'Bed', column: 'roomId' }],
};

const DEFAULTS: Record<string, Row> = {
  Hospital: {
    status: 'PENDING',
    verifiedAt: null,
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    defaultSlotMinutes: 30,
    subscriptionPlan: null,
    subscriptionStatus: 'TRIAL',
    addressId: null,
    taxRatePercent: new Prisma.Decimal(0),
    invoicePrefix: 'INV',
  },
  StaffProfile: {
    departmentId: null,
    employeeCode: null,
    designation: null,
    isSeniorLabTechnician: false,
  },
  Department: { description: null },
  Room: { departmentId: null, floor: null, dailyCharge: null },
  Bed: { status: 'AVAILABLE' },
  DoctorSchedule: { isActive: true, validTo: null },
  ScheduleException: { startTime: null, endTime: null, reason: null },
  Appointment: {
    status: 'PENDING',
    type: 'REGULAR',
    deletedAt: null,
    reason: null,
    cancellationReason: null,
  },
  Doctor: { deletedAt: null, signatureFileId: null, qualification: null, bio: null },
  MedicalRecord: {
    status: 'OPEN',
    closedAt: null,
    presentingSymptoms: null,
    treatmentPlanEnc: null,
  },
  RecordEntry: { amendsEntryId: null, correctionReason: null },
  Vitals: { supersedesId: null, correctionReason: null },
  Diagnosis: { icd10Code: null, supersedesId: null, correctionReason: null },
  Allergy: { reaction: null, severity: null },
  MedicationHistory: { dosage: null, frequency: null, startedOn: null, endedOn: null, notes: null },
  Vaccination: { nextDueOn: null },
  FamilyHistory: { relation: null, notes: null },
  FileAttachment: { patientId: null, medicalRecordId: null },
  Medicine: { genericName: null, isActive: true, lowStockSince: null },
  StockMovement: { reason: null, dispenseId: null, performedById: null, expiryReportId: null },
  PrescriptionEvent: { actorId: null, reason: null },
  MedicineBatch: { status: 'ACTIVE', supplierId: null },
  Prescription: {
    status: 'ISSUED',
    notes: null,
    pdfFileId: null,
    verifiedById: null,
    verifiedAt: null,
    cancelledAt: null,
    cancelledById: null,
    cancellationReason: null,
    allergyOverrideReason: null,
  },
  PrescriptionItem: { instructions: null },
  LabTest: { unit: null, sampleType: null, isActive: true, category: 'LABORATORY' },
  LabTestRange: { gender: null, ageMinYears: null, ageMaxYears: null },
  LabOrder: {
    status: 'ORDERED',
    priority: 'ROUTINE',
    sampleCollectedAt: null,
    sampleCollectedById: null,
    approvedAt: null,
    approvedById: null,
    rejectionReason: null,
    reportFileId: null,
    amendsLabOrderId: null,
    amendmentReason: null,
    clinicalNotes: null,
    cancelledAt: null,
    cancelledById: null,
    cancellationReason: null,
    rejectedAt: null,
    rejectedById: null,
  },
  LabResult: {
    valueNumeric: null,
    valueText: null,
    flag: null,
    unit: null,
    referenceLow: null,
    referenceHigh: null,
  },
};

/** Mirrors the clinical triggers in constraints.sql (DEC-016): append-only and status-only tables. */
const APPEND_ONLY = new Set([
  'RecordEntry',
  'Vitals',
  'Diagnosis',
  'AdministrationNote',
  'AuditLog',
]);
const STATUS_ONLY = new Set(['Allergy', 'MedicationHistory', 'Vaccination', 'FamilyHistory']);
const STATUS_COLUMNS = new Set(['status', 'statusReason', 'statusChangedById', 'statusChangedAt']);
const HISTORY_DEFAULTS = {
  status: 'ACTIVE',
  statusReason: null,
  statusChangedById: null,
  statusChangedAt: null,
  supersedesId: null,
  correctionReason: null,
  recordedAt: new Date(),
};

/** Applies update data the way Prisma does, including atomic { increment } / { decrement }. */
function applyData(row: Row, data: Row): void {
  for (const [k, v] of Object.entries(data)) {
    if (isPlain(v) && 'increment' in v) row[k] = (row[k] as number) + (v.increment as number);
    else if (isPlain(v) && 'decrement' in v) row[k] = (row[k] as number) - (v.decrement as number);
    else row[k] = v;
  }
}

function checkError(name: string): Error {
  return new Error(`new row violates check constraint "${name}"`);
}

/**
 * Mirrors M-09 and constraints.sql for the pharmacy tables: the ledger and dispenses are
 * append-only, ledger rows obey the sign/actor/reason/link CHECKs, batch quantity never below 0.
 */
function guardPharmacy(model: string, rows: Row[], op: 'create' | 'update' | 'delete'): void {
  if (
    (model === 'StockMovement' || model === 'Dispense' || model === 'PrescriptionEvent') &&
    op !== 'create' &&
    rows.length
  )
    throw triggerError(
      `${op.toUpperCase()} on ${model} is not permitted: this table is append-only`,
    );
  for (const r of rows) {
    if (model === 'MedicineBatch' && (r.quantity as number) < 0)
      throw checkError('medicine_batches_quantity_chk');
    if (model === 'Dispense' && !((r.quantity as number) > 0))
      throw checkError('dispenses_quantity_chk');
    if (model !== 'StockMovement') continue;
    const q = r.quantity as number;
    const reason = typeof r.reason === 'string' && r.reason.trim().length > 0;
    if (q === 0) throw checkError('stock_movements_nonzero_chk');
    if (
      (r.performedById == null) !== (r.expiryReportId != null) ||
      (r.expiryReportId != null && !(r.type === 'QUARANTINE' && reason))
    )
      throw checkError('stock_movements_system_chk');
    const sign =
      (r.type === 'RECEIPT' && q > 0) ||
      (r.type === 'DISPENSE' && q < 0) ||
      r.type === 'ADJUSTMENT' ||
      (r.type === 'QUARANTINE' && q > 0);
    if (!sign) throw checkError('stock_movements_sign_chk');
    if ((r.type === 'DISPENSE') !== (r.dispenseId != null))
      throw checkError('stock_movements_dispense_link_chk');
    if ((r.type === 'ADJUSTMENT' || r.type === 'QUARANTINE') && !reason)
      throw checkError('stock_movements_reason_chk');
  }
}

function triggerError(message: string): Error {
  return new Error(`${message} (integrity_constraint_violation)`);
}

/** Throws as the database triggers would for a change to `rows` with `data` (undefined = delete). */
function guardClinicalChange(model: string, rows: Row[], data?: Row): void {
  if (rows.length === 0) return;
  if (APPEND_ONLY.has(model)) throw triggerError(`${model} is append-only`);
  if (STATUS_ONLY.has(model)) {
    if (!data) throw triggerError(`${model} is append-only`);
    if (Object.keys(data).some((k) => !STATUS_COLUMNS.has(k) && k !== 'updatedAt'))
      throw triggerError(`Only the status of a ${model} entry can change`);
    if (rows.some((r) => r.status === 'ENTERED_IN_ERROR'))
      throw triggerError(`An entry marked ENTERED_IN_ERROR in ${model} cannot change`);
  }
  if (model === 'MedicalRecord') {
    if (!data) throw triggerError('MedicalRecord is append-only');
    if (rows.some((r) => r.status === 'CLOSED'))
      throw triggerError('Medical record is closed; add an addendum instead');
  }
}

function fkViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
    code: 'P2003',
    clientVersion: 'test',
  });
}

export class FakePrisma {
  hospitals: Hospital[] = [];
  users: User[] = [];
  patients: Patient[] = [];
  audit: AuditLog[] = [];
  /** Forces the next N patient.create calls to fail with an MRN collision. */
  mrnCollisions = 0;

  addHospital(p: Partial<Hospital> = {}): Hospital {
    const h = {
      id: randomUUID(),
      name: 'City Care Hospital',
      code: 'CITYCARE',
      email: 'admin@citycare.test',
      phone: '+910000000000',
      licenseNumber: 'LIC-1',
      status: 'VERIFIED',
      verifiedAt: new Date(),
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      defaultSlotMinutes: 30,
      subscriptionPlan: null,
      subscriptionStatus: 'TRIAL',
      addressId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      taxRatePercent: new Prisma.Decimal(0),
      invoicePrefix: 'INV',
      ...p,
    } as Hospital;
    this.hospitals.push(h);
    return h;
  }

  /** Inserts a user directly (test fixture), with sensible defaults. */
  addUser(p: Partial<User> & Pick<User, 'role'>): User {
    const u = {
      id: randomUUID(),
      hospitalId: null,
      email: `${randomUUID()}@example.test`,
      phone: null,
      passwordHash: 'x',
      firstName: 'Test',
      lastName: 'User',
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: null,
      isActive: true,
      lastLoginAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...p,
    } as User;
    this.users.push(u);
    return u;
  }

  /** Tables for every other model, created on first use. */
  readonly extra = new Map<string, Row[]>();

  rows(model: string): Row[] {
    return this.table(model);
  }

  private table(model: string): Row[] {
    switch (model) {
      case 'Hospital':
        return this.hospitals as unknown as Row[];
      case 'User':
        return this.users as unknown as Row[];
      case 'Patient':
        return this.patients as unknown as Row[];
      case 'AuditLog':
        return this.audit as unknown as Row[];
      default: {
        let t = this.extra.get(model);
        if (!t) this.extra.set(model, (t = []));
        return t;
      }
    }
  }

  private include(model: string, row: Row, include?: Row): Row {
    const out = { ...row };
    if (!include) return out;
    for (const [field, spec] of Object.entries(include)) {
      if (!spec) continue;
      const rel = RELATIONS[model]?.[field];
      if (!rel) throw new Error(`FakePrisma: unsupported include ${model}.${field}`);
      const target = this.table(rel.model);
      const nested =
        typeof spec === 'object' ? ((spec as Row).include as Row | undefined) : undefined;
      if (rel.many) {
        const where =
          typeof spec === 'object' ? ((spec as Row).where as Row | undefined) : undefined;
        out[field] = target
          .filter((t) => t[rel.foreign] === row[rel.local] && matches(t, where))
          .map((t) => this.include(rel.model, t, nested));
      } else {
        const hit = target.find((t) => row[rel.local] != null && t[rel.foreign] === row[rel.local]);
        out[field] = hit ? this.include(rel.model, hit, nested) : null;
      }
    }
    return out;
  }

  /** Applies a select, including nested relation selects (`{ patient: { select: { userId: true } } }`). */
  private project(row: Row, select?: Row, model?: string): Row {
    if (!select) return row;
    return Object.fromEntries(
      Object.keys(select)
        .filter((k) => select[k])
        .map((k) => {
          const spec = select[k];
          const rel = model ? RELATIONS[model]?.[k] : undefined;
          if (!rel || typeof spec !== 'object' || spec === null) return [k, row[k]];
          const nested = this.include(model!, row, { [k]: true })[k];
          const sub = (spec as Row).select as Row | undefined;
          const shape = (v: unknown) => (v && sub ? this.project(v as Row, sub, rel.model) : v);
          return [k, Array.isArray(nested) ? nested.map(shape) : shape(nested)];
        }),
    );
  }

  private checkUnique(model: string, row: Row, ignore?: Row): void {
    const rows = this.table(model).filter((r) => r !== ignore);
    if (model === 'Appointment') {
      // Mirrors the exclusion constraints appointments_doctor_no_overlap / appointments_patient_no_overlap.
      const live = (r: Row) =>
        !['CANCELLED', 'NO_SHOW'].includes(r.status as string) && r.deletedAt == null;
      const overlaps = (r: Row) =>
        (r.scheduledAt as Date) < (row.endAt as Date) &&
        (row.scheduledAt as Date) < (r.endAt as Date);
      if (live(row)) {
        const others = rows.filter((r) => live(r) && overlaps(r));
        if (
          row.type !== 'EMERGENCY' &&
          others.some((r) => r.doctorId === row.doctorId && r.type !== 'EMERGENCY')
        )
          throw new Error(
            'conflicting key value violates exclusion constraint "appointments_doctor_no_overlap"',
          );
        if (others.some((r) => r.patientId === row.patientId))
          throw new Error(
            'conflicting key value violates exclusion constraint "appointments_patient_no_overlap"',
          );
      }
    }
    for (const keys of UNIQUES[model] ?? []) {
      if (keys.some((k) => row[k] == null)) continue;
      if (rows.some((r) => keys.every((k) => same(r[k], row[k])))) throw unique(keys);
    }
    if (model === 'User' && rows.some((r) => r.email === row.email)) throw unique(['email']);
    if (model === 'Hospital' && rows.some((r) => r.code === row.code)) throw unique(['code']);
    if (model === 'Patient') {
      if (this.mrnCollisions > 0) {
        this.mrnCollisions--;
        throw unique(['hospitalId', 'mrn']);
      }
      if (rows.some((r) => r.hospitalId === row.hospitalId && r.mrn === row.mrn))
        throw unique(['hospitalId', 'mrn']);
    }
  }

  /**
   * Mirrors the M-09 and M-10 triggers: batch status rules and system quarantines, the prescription
   * workflow, prescription events and dispenses. `before` is null for inserts. Commit-time checks are
   * queued in `deferred` and run when the transaction commits.
   */
  private workflow(model: string, before: Row | null, row: Row): void {
    const t = (m: string) => this.table(m);
    const same = (a: unknown, b: unknown) =>
      a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
    const dateOf = (d: unknown) => (d as Date).toISOString().slice(0, 10);
    const itemsOf = (rxId: unknown) =>
      t('PrescriptionItem').filter((i) => i.prescriptionId === rxId);
    const given = (itemId: unknown) =>
      t('Dispense')
        .filter((d) => d.prescriptionItemId === itemId)
        .reduce((n, d) => n + (d.quantity as number), 0);
    if (model === 'MedicineBatch') {
      if (!before && row.status !== 'ACTIVE') throw triggerError('A new batch must be ACTIVE');
      if (before?.status === 'QUARANTINED' && row.status !== 'QUARANTINED')
        throw triggerError('A quarantined batch stays quarantined');
      if (row.status === 'DEPLETED' && row.quantity !== 0)
        throw triggerError('A depleted batch holds no units');
      if (
        before &&
        before.status !== 'QUARANTINED' &&
        row.status === 'QUARANTINED' &&
        (row.quantity as number) > 0
      )
        this.deferred.push(() => {
          if (
            !t('StockMovement').some(
              (m) => m.batchId === row.id && m.type === 'QUARANTINE' && this.touched.has(m),
            )
          )
            throw triggerError(
              'A quarantine needs its QUARANTINE ledger row in the same transaction',
            );
        });
    }
    if (model === 'StockMovement' && !before && row.expiryReportId != null) {
      const report = t('ExpiryReport').find(
        (r) => r.id === row.expiryReportId && r.hospitalId === row.hospitalId,
      );
      const hospital = t('Hospital').find((h) => h.id === row.hospitalId);
      if (!report || !this.touched.has(report))
        throw triggerError(
          'A system quarantine must be written with its expiry report, in the same transaction',
        );
      if (dateOf(report.runDate) !== localDate(this.clock(), hospital!.timezone as string))
        throw triggerError(
          'The expiry report of a system quarantine must be dated today in the hospital time zone',
        );
      if (
        !(report.items as Row[]).some((i) => i.batchId === row.batchId && i.kind === 'QUARANTINED')
      )
        throw triggerError('The expiry report does not list this batch as quarantined');
      const b = t('MedicineBatch').find(
        (x) => x.id === row.batchId && x.hospitalId === row.hospitalId,
      );
      if (
        !b ||
        dateOf(b.expiresOn) > dateOf(report.runDate) ||
        b.status !== 'QUARANTINED' ||
        !this.touched.has(b) ||
        row.quantity !== b.quantity
      )
        throw triggerError(
          'A system quarantine must be an expired batch quarantined in this transaction, with its physical quantity',
        );
      if (t('StockMovement').some((m) => m.batchId === row.batchId && m.expiryReportId != null))
        throw unique(['batchId']);
    }
    if (model === 'Prescription') {
      if (!before) {
        if (
          row.status !== 'ISSUED' ||
          row.verifiedAt != null ||
          row.verifiedById != null ||
          row.cancelledAt != null ||
          row.pdfFileId != null
        )
          throw triggerError('A new prescription starts ISSUED, unverified, without a PDF');
        this.deferred.push(() => {
          if (
            !t('PrescriptionEvent').some(
              (e) => e.prescriptionId === row.id && e.kind === 'ISSUED' && this.touched.has(e),
            )
          )
            throw triggerError('A new prescription needs its ISSUED event');
        });
        return;
      }
      for (const k of [
        'hospitalId',
        'medicalRecordId',
        'notes',
        'issuedAt',
        'allergyOverrideReason',
      ])
        if (!same(before[k], row[k]))
          throw triggerError('A prescription is never edited after issue');
      if (before.pdfFileId != null && row.pdfFileId !== before.pdfFileId)
        throw triggerError('The prescription PDF is attached once');
      if (before.verifiedAt != null) {
        if (!same(row.verifiedAt, before.verifiedAt) || row.verifiedById !== before.verifiedById)
          throw triggerError('A verification cannot change');
      } else if (row.verifiedAt != null || row.verifiedById != null) {
        if (row.verifiedAt == null || row.verifiedById == null || before.status !== 'ISSUED')
          throw triggerError('Verification needs who and when, while the prescription is ISSUED');
      }
      const cancelling = before.status !== 'CANCELLED' && row.status === 'CANCELLED';
      if (
        !cancelling &&
        ['cancelledAt', 'cancelledById', 'cancellationReason'].some((k) => !same(before[k], row[k]))
      )
        throw triggerError('Cancellation details are recorded only when cancelling');
      const newlyVerified = before.verifiedAt == null && row.verifiedAt != null;
      if (newlyVerified)
        this.deferred.push(() => {
          if (
            !t('PrescriptionEvent').some(
              (e) => e.prescriptionId === row.id && e.kind === 'VERIFIED' && this.touched.has(e),
            )
          )
            throw triggerError('A verification needs its VERIFIED event');
        });
      if (row.status === before.status) return;
      const moves: Record<string, string[]> = {
        ISSUED: ['PARTIALLY_DISPENSED', 'READY_FOR_PICKUP', 'CANCELLED'],
        PARTIALLY_DISPENSED: ['READY_FOR_PICKUP'],
        READY_FOR_PICKUP: ['DISPENSED'],
      };
      if (!(moves[before.status as string] ?? []).includes(row.status as string))
        throw triggerError(`A prescription cannot move from ${before.status} to ${row.status}`);
      const items = itemsOf(row.id);
      const dispensed = items.some((i) => given(i.id) > 0);
      const incomplete = items.some((i) => (i.quantity as number) > given(i.id));
      if (row.status === 'CANCELLED' && dispensed)
        throw triggerError('A prescription with dispensed items cannot be cancelled');
      if (
        ['PARTIALLY_DISPENSED', 'READY_FOR_PICKUP'].includes(row.status as string) &&
        (row.verifiedAt == null || !dispensed)
      )
        throw triggerError('Dispensing needs a verified prescription and at least one dispense');
      if (row.status === 'PARTIALLY_DISPENSED' && !incomplete)
        throw triggerError(
          'Every item is complete: the prescription is ready, not partly dispensed',
        );
      if (row.status === 'READY_FOR_PICKUP' && incomplete)
        throw triggerError('Ready for collection needs every item fully dispensed');
      this.deferred.push(() => {
        const live = t('Prescription').find((p) => p.id === row.id)!;
        if (
          !t('PrescriptionEvent').some(
            (e) =>
              e.prescriptionId === row.id &&
              e.status === live.status &&
              e.kind !== 'BASELINE' &&
              this.touched.has(e),
          )
        )
          throw triggerError('A prescription status change needs its history event');
      });
    }
    if (model === 'PrescriptionEvent') {
      if (before)
        throw triggerError(
          'UPDATE on PrescriptionEvent is not permitted: this table is append-only',
        );
      if (row.kind === 'BASELINE')
        throw triggerError('BASELINE events are written only by migration M-10');
      const p = t('Prescription').find(
        (x) => x.id === row.prescriptionId && x.hospitalId === row.hospitalId,
      );
      if (!p || !this.touched.has(p) || p.status !== row.status)
        throw triggerError('A prescription event must be written with the change it records');
      if (row.kind === 'VERIFIED' && (p.verifiedAt == null || p.verifiedById !== row.actorId))
        throw triggerError('A VERIFIED event must match the recorded verification');
      if (row.actorId == null) throw checkError('prescription_events_actor_chk');
      if (row.kind === 'CANCELLED' && !(typeof row.reason === 'string' && row.reason.trim()))
        throw checkError('prescription_events_reason_chk');
      if (
        ['ISSUED', 'VERIFIED', 'HANDED_OVER', 'CANCELLED'].includes(row.kind as string) &&
        t('PrescriptionEvent').some(
          (e) => e.prescriptionId === row.prescriptionId && e.kind === row.kind,
        )
      )
        throw unique(['prescriptionId', 'kind']);
    }
    if (model === 'Dispense' && !before) {
      const item = t('PrescriptionItem').find((i) => i.id === row.prescriptionItemId);
      const p =
        item &&
        t('Prescription').find(
          (x) => x.id === item.prescriptionId && x.hospitalId === row.hospitalId,
        );
      if (
        !p ||
        !['ISSUED', 'PARTIALLY_DISPENSED'].includes(p.status as string) ||
        p.verifiedAt == null
      )
        throw triggerError('Dispensing needs a verified prescription that is waiting');
      if ((row.quantity as number) + given(item!.id) > (item!.quantity as number))
        throw triggerError('More than the prescribed quantity cannot be dispensed');
      this.deferred.push(() => {
        const live = t('Prescription').find((x) => x.id === p.id)!;
        if (
          !['PARTIALLY_DISPENSED', 'READY_FOR_PICKUP'].includes(live.status as string) ||
          !this.touched.has(live)
        )
          throw triggerError(
            'A dispense needs its prescription status update in the same transaction',
          );
      });
    }
  }

  /** Mirrors the approved-lab triggers in constraints.sql: approved orders and their results are locked. */
  private guardLab(model: string, rows: Row[], data: Row): void {
    if (model === 'LabResult') {
      for (const r of rows) {
        const item = this.table('LabOrderItem').find((i) => i.id === r.labOrderItemId);
        const order = item && this.table('LabOrder').find((o) => o.id === item.labOrderId);
        if (order?.status === 'APPROVED')
          throw triggerError('Results of an approved lab order are locked');
      }
    }
    if (
      model === 'LabOrder' &&
      Object.keys(data).some((k) => k !== 'reportFileId' && k !== 'updatedAt')
    ) {
      if (rows.some((r) => r.status === 'APPROVED' && this.table('LabOrder').includes(r)))
        throw triggerError('Lab order is approved and locked');
    }
  }

  private defaults(model: string): Row {
    const base = { id: randomUUID(), createdAt: new Date() };
    if (model === 'User')
      return {
        ...base,
        hospitalId: null,
        phone: null,
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
        isActive: true,
        lastLoginAt: null,
        deletedAt: null,
        updatedAt: new Date(),
      };
    if (model === 'Patient')
      return {
        ...base,
        updatedAt: new Date(),
        deletedAt: null,
        bloodGroup: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        addressId: null,
      };
    if (STATUS_ONLY.has(model))
      return {
        ...base,
        updatedAt: new Date(),
        ...HISTORY_DEFAULTS,
        recordedAt: new Date(),
        ...(DEFAULTS[model] ?? {}),
      };
    if (model === 'Vitals') return { ...base, recordedAt: new Date(), ...(DEFAULTS[model] ?? {}) };
    if (model === 'Prescription')
      return { ...base, issuedAt: new Date(), updatedAt: new Date(), ...(DEFAULTS[model] ?? {}) };
    if (model === 'MedicineBatch')
      return { ...base, receivedAt: new Date(), updatedAt: new Date(), ...(DEFAULTS[model] ?? {}) };
    if (model === 'Dispense')
      return { ...base, dispensedAt: new Date(), ...(DEFAULTS[model] ?? {}) };
    if (model === 'PrescriptionEvent')
      return { id: base.id, occurredAt: new Date(), ...(DEFAULTS[model] ?? {}) };
    return { ...base, updatedAt: new Date(), ...(DEFAULTS[model] ?? {}) };
  }

  private referenced(model: string, row: Row): boolean {
    return (REFERENCES[model] ?? []).some((ref) =>
      this.table(ref.model).some((r) => r[ref.column] === row.id),
    );
  }

  /** `matches` plus relation filters (to-one: nested where; to-many: some / none / every). */
  private match(model: string, row: Row, where: Row | undefined): boolean {
    if (!where) return true;
    return Object.entries(where).every(([key, cond]) => {
      if (cond === undefined) return true;
      if (key === 'AND') return (cond as Row[]).every((w) => this.match(model, row, w));
      if (key === 'OR') return (cond as Row[]).some((w) => this.match(model, row, w));
      if (key === 'NOT') return !this.match(model, row, cond as Row);
      const rel = RELATIONS[model]?.[key];
      if (!rel) return matches(row, { [key]: cond });
      const related = this.table(rel.model).filter(
        (r) => row[rel.local] != null && r[rel.foreign] === row[rel.local],
      );
      const c = cond as Row;
      if (rel.many) {
        if (c.some) return related.some((r) => this.match(rel.model, r, c.some as Row));
        if (c.none) return !related.some((r) => this.match(rel.model, r, c.none as Row));
        if (c.every) return related.every((r) => this.match(rel.model, r, c.every as Row));
        return true;
      }
      return related.length > 0 && this.match(rel.model, related[0]!, c);
    });
  }

  /** Executes one operation on the in-memory tables. */
  private exec(model: string, op: string, raw: Args): Promise<unknown> {
    // Prisma ignores `undefined` fields in data; so does the fake.
    const strip = (d: unknown) =>
      d && typeof d === 'object' && !Array.isArray(d)
        ? Object.fromEntries(Object.entries(d as Row).filter(([, v]) => v !== undefined))
        : d;
    const a: Args = {
      ...raw,
      ...(raw.data !== undefined
        ? { data: Array.isArray(raw.data) ? raw.data.map(strip) : strip(raw.data) }
        : {}),
    };
    const rows = this.table(model);
    const where = a.where as Row | undefined;
    const found = () => rows.find((r) => this.match(model, r, where));
    const shape = (r: Row) =>
      this.project(
        this.include(model, r, a.include as Row | undefined),
        a.select as Row | undefined,
        model,
      );
    try {
      switch (op) {
        case 'findUnique':
        case 'findFirst': {
          const r = found();
          return Promise.resolve(r ? shape(r) : null);
        }
        case 'findUniqueOrThrow':
        case 'findFirstOrThrow': {
          const r = found();
          if (!r) throw notFound();
          return Promise.resolve(shape(r));
        }
        case 'findMany': {
          const list = sortRows(
            rows.filter((r) => this.match(model, r, where)),
            a.orderBy,
          );
          const skip = (a.skip as number | undefined) ?? 0;
          const take = (a.take as number | undefined) ?? list.length;
          return Promise.resolve(list.slice(skip, skip + take).map(shape));
        }
        case 'count':
          return Promise.resolve(rows.filter((r) => this.match(model, r, where)).length);
        case 'create': {
          const row = { ...this.defaults(model), ...(a.data as Row) };
          this.guardLab(model, [row], a.data as Row);
          guardPharmacy(model, [row], 'create');
          this.checkUnique(model, row);
          this.workflow(model, null, row);
          rows.push(row);
          this.touched.add(row);
          return Promise.resolve(shape(row));
        }
        case 'update': {
          const r = found();
          if (!r) throw notFound();
          guardClinicalChange(model, [r], a.data as Row);
          this.guardLab(model, [r], a.data as Row);
          guardPharmacy(model, [r], 'update');
          const next = { ...r };
          applyData(next, a.data as Row);
          guardPharmacy(model, model === 'StockMovement' ? [] : [next], 'create');
          this.checkUnique(model, next, r);
          this.workflow(model, r, next);
          applyData(r, a.data as Row);
          this.touched.add(r);
          if (model === 'User') r.updatedAt = new Date();
          return Promise.resolve(shape(r));
        }
        case 'delete': {
          const r = found();
          if (!r) throw notFound();
          guardClinicalChange(model, [r]);
          guardPharmacy(model, [r], 'delete');
          if (this.referenced(model, r)) throw fkViolation();
          rows.splice(rows.indexOf(r), 1);
          return Promise.resolve(shape(r));
        }
        case 'deleteMany': {
          const hit = rows.filter((r) => this.match(model, r, where));
          guardClinicalChange(model, hit);
          guardPharmacy(model, hit, 'delete');
          for (const r of hit) rows.splice(rows.indexOf(r), 1);
          return Promise.resolve({ count: hit.length });
        }
        case 'updateMany': {
          const hit = rows.filter((r) => this.match(model, r, where));
          guardClinicalChange(model, hit, a.data as Row);
          this.guardLab(model, hit, a.data as Row);
          guardPharmacy(model, hit, 'update');
          const nexts = hit.map((r) => {
            const n = { ...r };
            applyData(n, a.data as Row);
            return n;
          });
          guardPharmacy(model, model === 'StockMovement' ? [] : nexts, 'create');
          hit.forEach((r, i) => this.workflow(model, r, nexts[i]!));
          hit.forEach((r) => (applyData(r, a.data as Row), this.touched.add(r)));
          return Promise.resolve({ count: hit.length });
        }
        case 'createMany':
        case 'createManyAndReturn': {
          // skipDuplicates mirrors INSERT ... ON CONFLICT DO NOTHING: a row that would break a
          // unique key is left out and nothing is thrown.
          const created: Row[] = [];
          for (const d of a.data as Row[]) {
            const row = { ...this.defaults(model), ...d };
            guardPharmacy(model, [row], 'create');
            try {
              this.checkUnique(model, row);
            } catch (e) {
              if (a.skipDuplicates && e instanceof Prisma.PrismaClientKnownRequestError) continue;
              throw e;
            }
            this.workflow(model, null, row);
            rows.push(row);
            this.touched.add(row);
            created.push(row);
          }
          return Promise.resolve(
            op === 'createMany' ? { count: created.length } : created.map((r) => shape(r)),
          );
        }
        default:
          throw new Error(`FakePrisma: unsupported operation ${model}.${op}`);
      }
    } catch (e) {
      return Promise.reject(e);
    }
  }

  private delegate(model: string, hook?: Hook) {
    const ops = [
      'findUnique',
      'findUniqueOrThrow',
      'findFirst',
      'findFirstOrThrow',
      'findMany',
      'count',
      'create',
      'update',
      'delete',
      'deleteMany',
      'updateMany',
      'createMany',
      'createManyAndReturn',
    ];
    return Object.fromEntries(
      ops.map((op) => [
        op,
        (args: Args = {}) => {
          const run = () =>
            hook
              ? hook({ model, operation: op, args, query: (x) => this.exec(model, op, x) })
              : this.exec(model, op, args);
          return WRITES.has(op) && this.txDepth === 0 ? this.$transaction(() => run()) : run();
        },
      ]),
    );
  }

  hospital = this.delegate('Hospital');
  user = this.delegate('User');
  patient = this.delegate('Patient');
  auditLog = this.delegate('AuditLog');
  department = this.delegate('Department');
  staffProfile = this.delegate('StaffProfile');
  doctor = this.delegate('Doctor');
  doctorDepartment = this.delegate('DoctorDepartment');
  room = this.delegate('Room');
  bed = this.delegate('Bed');
  fileAttachment = this.delegate('FileAttachment');
  doctorSchedule = this.delegate('DoctorSchedule');
  scheduleException = this.delegate('ScheduleException');
  appointment = this.delegate('Appointment');
  medicalRecord = this.delegate('MedicalRecord');
  medicine = this.delegate('Medicine');
  medicineBatch = this.delegate('MedicineBatch');
  prescription = this.delegate('Prescription');
  prescriptionItem = this.delegate('PrescriptionItem');
  dispense = this.delegate('Dispense');
  stockMovement = this.delegate('StockMovement');
  expiryReport = this.delegate('ExpiryReport');
  prescriptionEvent = this.delegate('PrescriptionEvent');
  labOrder = this.delegate('LabOrder');
  notification = this.delegate('Notification');
  notificationDelivery = this.delegate('NotificationDelivery');

  /** Query extensions, as used by TenantPrismaService. */
  $extends(ext: { query?: { $allModels?: { $allOperations?: Hook } } }): unknown {
    const hook = ext.query?.$allModels?.$allOperations;
    const client: Record<string, unknown> = {};
    for (const [key, model] of Object.entries(MODEL_OF)) client[key] = this.delegate(model, hook);
    // Interactive transactions on the extended client keep the extension (as in Prisma).
    client.$transaction = (fn: (tx: unknown) => Promise<unknown>) =>
      this.$transaction(() => fn(client));
    return client;
  }

  /** Clock used for "today in the hospital time zone" checks (M-09); tests may set it. */
  clock: () => Date = () => new Date();
  private txDepth = 0;
  /** Rows created or changed by the current transaction (PostgreSQL: xmin = current transaction). */
  private touched = new Set<Row>();
  /** Checks PostgreSQL runs at commit (DEFERRABLE INITIALLY DEFERRED constraint triggers). */
  private deferred: (() => void)[] = [];

  private snapshot() {
    const arrays = [
      this.hospitals,
      this.users,
      this.patients,
      this.audit,
      ...this.extra.values(),
    ] as Row[][];
    return {
      tables: new Map(this.extra),
      arrays: arrays.map((a) => [a, [...a]] as const),
      values: new Map(arrays.flat().map((r) => [r, { ...r }])),
    };
  }

  private restore(snap: ReturnType<FakePrisma['snapshot']>): void {
    for (const [a, members] of snap.arrays) a.splice(0, a.length, ...members);
    for (const [row, values] of snap.values) {
      for (const k of Object.keys(row)) if (!(k in values)) delete row[k];
      Object.assign(row, values);
    }
    this.extra.clear();
    for (const [k, v] of snap.tables) this.extra.set(k, v);
  }

  /**
   * One transaction: a failure anywhere (including the commit-time checks) restores every table
   * and row value, as PostgreSQL rolls back. Writes outside a transaction run as their own.
   */
  async $transaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    const snap = this.txDepth === 0 ? this.snapshot() : null;
    this.txDepth++;
    try {
      const result = await fn(this);
      if (this.txDepth === 1) {
        const checks = this.deferred;
        this.deferred = [];
        for (const check of checks) check();
      }
      return result;
    } catch (e) {
      if (snap) {
        this.restore(snap);
        this.deferred = [];
      }
      throw e;
    } finally {
      this.txDepth--;
      if (this.txDepth === 0) this.touched.clear();
    }
  }

  actions(): string[] {
    return this.audit.map((a) => a.action);
  }
}
