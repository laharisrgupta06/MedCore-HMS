/**
 * In-memory stand-in for the subset of PrismaClient used by the auth and users modules, for unit
 * tests only. Supports equality / null / contains (insensitive) / in / OR / AND filters, ordering,
 * paging, the `include` relations the services use, query extensions ($extends with
 * $allModels.$allOperations, used by the tenant client) and the unique constraints the code relies
 * on (users.email, patients(hospitalId, mrn)). Real PostgreSQL behaviour is covered by the
 * integration tests (T-MIG-*, T-AUTH-INT-001 on macOS).
 */
import { randomUUID } from 'node:crypto';
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

  private project(row: Row, select?: Row): Row {
    if (!select) return row;
    return Object.fromEntries(
      Object.keys(select)
        .filter((k) => select[k])
        .map((k) => [k, row[k]]),
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
          this.checkUnique(model, row);
          rows.push(row);
          return Promise.resolve(shape(row));
        }
        case 'update': {
          const r = found();
          if (!r) throw notFound();
          guardClinicalChange(model, [r], a.data as Row);
          const next = { ...r, ...(a.data as Row) };
          this.checkUnique(model, next, r);
          Object.assign(r, a.data as Row, model === 'User' ? { updatedAt: new Date() } : {});
          return Promise.resolve(shape(r));
        }
        case 'delete': {
          const r = found();
          if (!r) throw notFound();
          guardClinicalChange(model, [r]);
          if (this.referenced(model, r)) throw fkViolation();
          rows.splice(rows.indexOf(r), 1);
          return Promise.resolve(shape(r));
        }
        case 'deleteMany': {
          const hit = rows.filter((r) => this.match(model, r, where));
          guardClinicalChange(model, hit);
          for (const r of hit) rows.splice(rows.indexOf(r), 1);
          return Promise.resolve({ count: hit.length });
        }
        case 'updateMany': {
          const hit = rows.filter((r) => this.match(model, r, where));
          guardClinicalChange(model, hit, a.data as Row);
          for (const r of hit) Object.assign(r, a.data as Row);
          return Promise.resolve({ count: hit.length });
        }
        case 'createMany': {
          for (const d of a.data as Row[]) {
            const row = { ...this.defaults(model), ...d };
            this.checkUnique(model, row);
            rows.push(row);
          }
          return Promise.resolve({ count: (a.data as Row[]).length });
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
    ];
    return Object.fromEntries(
      ops.map((op) => [
        op,
        (args: Args = {}) =>
          hook
            ? hook({ model, operation: op, args, query: (x) => this.exec(model, op, x) })
            : this.exec(model, op, args),
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

  /** Rolls back users and patients created inside a failed transaction. */
  async $transaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    const users = [...this.users];
    const patients = [...this.patients];
    const extra: [string, Row[]][] = [...this.extra.entries()].map(([k, v]) => [k, [...v]]);
    try {
      return await fn(this);
    } catch (e) {
      // Delegates read the arrays through table(), so reassignment is visible.
      this.users = users;
      this.patients = patients;
      this.extra.clear();
      for (const [k, v] of extra) this.extra.set(k, v);
      throw e;
    }
  }

  actions(): string[] {
    return this.audit.map((a) => a.action);
  }
}
