import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  AppointmentErrorCode,
  bmi,
  EmrErrorCode,
  MAX_CLINICAL_FILE_BYTES,
  type Allergy as AllergyView,
  type ClinicalFile,
  type Diagnosis as DiagnosisView,
  type FamilyHistoryEntry,
  type Icd10Code,
  type MedicalRecord as RecordView,
  type MedicationHistoryEntry,
  type PatientHistory,
  type RecordEntry as EntryView,
  type Vaccination as VaccinationView,
  type Vitals as VitalsView,
} from '@medcore/types';
import { Prisma, type User } from '@prisma/client';
import type { AuthPrincipal } from '../../common/auth/decorators';
import { PaginatedResult } from '../../common/http/paginated-result';
import { mapPrismaError, notFound } from '../../common/http/prisma-errors';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { FIELD_CRYPTO, type FieldCrypto } from '../../infra/crypto/field-crypto';
import { StorageService } from '../../infra/storage/storage.service';
import type {
  AllergyDto,
  DiagnosisDto,
  EntryDto,
  FamilyHistoryDto,
  HistoryStatusDto,
  MedicationDto,
  StartEncounterDto,
  UpdateRecordDto,
  VaccinationDto,
  VitalsDto,
} from './emr.dto';

const bad = (code: string, message: string) => new BadRequestException({ code, message });
const conflict = (code: string, message: string) => new ConflictException({ code, message });

const include = {
  appointment: {
    include: {
      doctor: { include: { user: true } },
      patient: { include: { user: true } },
      department: true,
    },
  },
  entries: { include: { author: true } },
  vitals: { include: { recordedBy: true } },
  diagnoses: { include: { recordedBy: true, icd10: true } },
  files: { include: { uploadedBy: true } },
} as const;
type RecordRow = Prisma.MedicalRecordGetPayload<{ include: typeof include }>;

const person = (u: User) => ({
  id: u.id,
  firstName: u.firstName,
  lastName: u.lastName,
  role: u.role,
});
const iso = (d: Date) => d.toISOString();
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const n = (v: Prisma.Decimal | number | null) => (v == null ? null : Number(v));
const byTime = <T>(rows: T[], key: (r: T) => Date) =>
  [...rows].sort((a, b) => key(a).getTime() - key(b).getTime());

/** Accepted attachment types, recognised from the file's first bytes (SEC-013); the name must agree. */
const FILE_TYPES: { mime: string; ext: string[]; test: (b: Buffer) => boolean }[] = [
  {
    mime: 'application/pdf',
    ext: ['pdf'],
    test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  },
  {
    mime: 'image/png',
    ext: ['png'],
    test: (b) =>
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/jpeg',
    ext: ['jpg', 'jpeg'],
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/webp',
    ext: ['webp'],
    test: (b) =>
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

type HistoryKind = 'allergies' | 'medications' | 'vaccinations' | 'familyHistory';
const HISTORY_MODEL = {
  allergies: 'allergy',
  medications: 'medicationHistory',
  vaccinations: 'vaccination',
  familyHistory: 'familyHistory',
} as const;

/**
 * Electronic medical records (SCOPE-010/011, EMR-001..012). Clinical rows are never edited or
 * deleted: a correction is a new row pointing at the original, with a reason (DEC-016); the
 * database triggers enforce the same rules. Notes, treatment plans and diagnosis text are stored
 * encrypted (pgcrypto, SEC-014). Access (API-019): doctors and nurses of the hospital, and the
 * patient for their own record only; writes to an encounter are limited to its treating doctor,
 * except vitals, which nurses may also record.
 */
@Injectable()
export class EmrService {
  constructor(
    private readonly db: TenantPrismaService,
    @Inject(FIELD_CRYPTO) private readonly crypto: FieldCrypto,
    private readonly storage: StorageService,
  ) {}

  // ------------------------------------------------------------------ encounter lifecycle

  /** EMR-001: starting the consultation creates the record and moves the appointment to IN_PROGRESS. */
  async start(actor: AuthPrincipal, dto: StartEncounterDto): Promise<RecordView> {
    const a = await this.db.client.appointment.findFirst({
      where: { id: dto.appointmentId, deletedAt: null },
      include: { doctor: true, medicalRecord: true },
    });
    if (!a || a.doctor.userId !== actor.userId) throw notFound('appointment');
    if (a.medicalRecord)
      throw conflict(EmrErrorCode.RECORD_EXISTS, 'This consultation has already started.');
    if (a.status !== 'CONFIRMED')
      throw bad(
        AppointmentErrorCode.INVALID_TRANSITION,
        a.status === 'PENDING'
          ? 'Confirm the appointment before starting the consultation.'
          : `An appointment that is ${a.status.toLowerCase().replace('_', ' ')} cannot be started.`,
      );
    const id = await this.db.client
      .$transaction(async (tx) => {
        await tx.appointment.update({ where: { id: a.id }, data: { status: 'IN_PROGRESS' } });
        const r = await tx.medicalRecord.create({
          data: {
            hospitalId: a.hospitalId,
            appointmentId: a.id,
            chiefComplaint: dto.chiefComplaint,
            presentingSymptoms: dto.presentingSymptoms || null,
          },
        });
        return r.id;
      })
      .catch((e) => mapPrismaError(e, { conflict: 'This consultation has already started.' }));
    return this.get(actor, id);
  }

  async update(actor: AuthPrincipal, id: string, dto: UpdateRecordDto): Promise<RecordView> {
    const r = await this.writable(actor, id, true);
    const [plan] = dto.treatmentPlan ? await this.crypto.encrypt([dto.treatmentPlan]) : [undefined];
    await this.db.client.medicalRecord.update({
      where: { id: r.id },
      data: {
        ...(dto.chiefComplaint !== undefined ? { chiefComplaint: dto.chiefComplaint } : {}),
        ...(dto.presentingSymptoms !== undefined
          ? { presentingSymptoms: dto.presentingSymptoms || null }
          : {}),
        ...(dto.treatmentPlan !== undefined ? { treatmentPlanEnc: plan ?? null } : {}),
      },
    });
    return this.get(actor, id);
  }

  // ------------------------------------------------------------------ reading

  async get(actor: AuthPrincipal, id: string): Promise<RecordView> {
    return (await this.views([await this.load(actor, id)]))[0]!;
  }

  /** API-019: a patient's chart, newest first. Patients may open only their own. */
  async chart(actor: AuthPrincipal, patientId: string, page: number, limit: number) {
    const p = await this.patientFor(actor, patientId);
    const where = { appointment: { patientId: p.id } };
    const [rows, total] = await Promise.all([
      this.db.client.medicalRecord.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.client.medicalRecord.count({ where }),
    ]);
    return PaginatedResult.of(await this.views(rows), total, page, limit);
  }

  // ------------------------------------------------------------------ encounter content

  /** EMR-002: notes while open, addenda afterwards; a correction is an addendum to one entry. */
  async addEntry(actor: AuthPrincipal, id: string, dto: EntryDto): Promise<RecordView> {
    const r = await this.writable(actor, id, false);
    if (dto.amendsEntryId) {
      const original = r.entries.find((e) => e.id === dto.amendsEntryId);
      if (!original) throw notFound('note');
      if (r.entries.some((e) => e.amendsEntryId === original.id))
        throw conflict(
          EmrErrorCode.ALREADY_CORRECTED,
          'This note already has a correction. Correct the newest version instead.',
        );
    }
    const [body] = await this.crypto.encrypt([dto.body]);
    await this.db.client.recordEntry
      .create({
        data: {
          hospitalId: r.hospitalId,
          medicalRecordId: r.id,
          authorId: actor.userId,
          kind: dto.amendsEntryId || r.status === 'CLOSED' ? 'ADDENDUM' : 'NOTE',
          bodyEnc: body!,
          amendsEntryId: dto.amendsEntryId ?? null,
          correctionReason: dto.amendsEntryId ? dto.correctionReason! : null,
        },
      })
      .catch((e) => mapPrismaError(e, { conflict: 'This note already has a correction.' }));
    return this.get(actor, id);
  }

  /** EMR-003. Doctors and nurses; new readings only while the encounter is open, corrections any time. */
  async addVitals(actor: AuthPrincipal, id: string, dto: VitalsDto): Promise<RecordView> {
    const r = await this.load(actor, id);
    if (actor.role === 'DOCTOR') this.assertTreating(actor, r);
    this.checkCorrection(r.vitals, dto, r.status, 'reading');
    const { supersedesId, correctionReason, ...values } = dto;
    if (Object.values(values).every((v) => v === undefined))
      throw bad('VALIDATION_ERROR', 'Enter at least one measurement.');
    await this.db.client.vitals
      .create({
        data: {
          hospitalId: r.hospitalId,
          medicalRecordId: r.id,
          recordedById: actor.userId,
          ...values,
          supersedesId: supersedesId ?? null,
          correctionReason: supersedesId ? correctionReason! : null,
        },
      })
      .catch((e) => mapPrismaError(e, { conflict: 'This reading already has a correction.' }));
    return this.get(actor, id);
  }

  /** EMR-005: differential and confirmed diagnoses, ICD-10 where possible. */
  async addDiagnosis(actor: AuthPrincipal, id: string, dto: DiagnosisDto): Promise<RecordView> {
    const r = await this.load(actor, id);
    this.assertTreating(actor, r);
    this.checkCorrection(r.diagnoses, dto, r.status, 'diagnosis');
    if (
      dto.icd10Code &&
      !(await this.db.client.icd10Code.findUnique({ where: { code: dto.icd10Code } }))
    )
      throw bad(
        'VALIDATION_ERROR',
        `ICD-10 code ${dto.icd10Code} is not in the code list. Leave it empty or choose one from the search.`,
      );
    const [description] = await this.crypto.encrypt([dto.description]);
    await this.db.client.diagnosis
      .create({
        data: {
          hospitalId: r.hospitalId,
          medicalRecordId: r.id,
          recordedById: actor.userId,
          icd10Code: dto.icd10Code ?? null,
          descriptionEnc: description!,
          type: dto.type,
          supersedesId: dto.supersedesId ?? null,
          correctionReason: dto.supersedesId ? dto.correctionReason! : null,
        },
      })
      .catch((e) => mapPrismaError(e, { conflict: 'This diagnosis already has a correction.' }));
    return this.get(actor, id);
  }

  /** EMR-010: scanned documents and images, max 20 MB, type checked from content (SEC-013). */
  async addFile(
    actor: AuthPrincipal,
    id: string,
    file: UploadedFile | undefined,
  ): Promise<RecordView> {
    const r = await this.load(actor, id);
    if (actor.role === 'DOCTOR') this.assertTreating(actor, r);
    if (!file) throw bad('VALIDATION_ERROR', 'Attach the file as the "file" field.');
    if (file.size === 0) throw bad(EmrErrorCode.FILE_REJECTED, 'The file is empty.');
    if (file.size > MAX_CLINICAL_FILE_BYTES)
      throw bad(EmrErrorCode.FILE_REJECTED, 'Files must be 20 MB or smaller.');
    const ext = file.originalname.toLowerCase().split('.').pop() ?? '';
    const type = FILE_TYPES.find((t) => t.test(file.buffer));
    if (!type || !type.ext.includes(ext) || (file.mimetype && file.mimetype !== type.mime))
      throw bad(
        EmrErrorCode.FILE_REJECTED,
        'Only PDF, PNG, JPEG and WebP files are accepted, and the file name must match its type.',
      );
    const key = `${r.hospitalId}/records/${r.id}/${randomUUID()}.${type.ext[0]}`;
    await this.storage.put(key, file.buffer);
    await this.db.client.fileAttachment.create({
      data: {
        hospitalId: r.hospitalId,
        patientId: r.appointment.patientId,
        medicalRecordId: r.id,
        purpose: 'MEDICAL_ATTACHMENT',
        storageKey: key,
        originalName: file.originalname.replace(/[^\w.\- ()]/g, '_').slice(0, 200),
        mimeType: type.mime,
        sizeBytes: file.size,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        uploadedById: actor.userId,
      },
    });
    return this.get(actor, id);
  }

  /** Download with the same access rule as the record it belongs to. */
  async file(
    actor: AuthPrincipal,
    fileId: string,
  ): Promise<{ name: string; mime: string; data: Buffer }> {
    const f = await this.db.client.fileAttachment.findFirst({
      where: { id: fileId, purpose: 'MEDICAL_ATTACHMENT' },
    });
    if (!f?.medicalRecordId) throw notFound('file');
    await this.load(actor, f.medicalRecordId).catch(() => {
      throw notFound('file');
    });
    return { name: f.originalName, mime: f.mimeType, data: await this.storage.get(f.storageKey) };
  }

  // ------------------------------------------------------------------ patient-level history (EMR-007..009, EMR-011)

  async history(actor: AuthPrincipal, patientId: string): Promise<PatientHistory> {
    const p = await this.patientFor(actor, patientId);
    const db = this.db.client;
    const q = { where: { patientId: p.id }, include: { recordedBy: true } } as const;
    const [allergies, medications, vaccinations, family] = await Promise.all([
      db.allergy.findMany(q),
      db.medicationHistory.findMany(q),
      db.vaccination.findMany(q),
      db.familyHistory.findMany(q),
    ]);
    const corrected = (rows: { supersedesId: string | null }[]) =>
      new Set(rows.map((r) => r.supersedesId).filter(Boolean));
    const base = <R extends HistoryRow>(r: R, set: Set<string | null>) => ({
      id: r.id,
      by: person(r.recordedBy),
      at: iso(r.recordedAt),
      supersedesId: r.supersedesId,
      correctionReason: r.correctionReason,
      corrected: set.has(r.id),
      status: r.status,
      statusReason: r.statusReason,
      statusChangedAt: r.statusChangedAt ? iso(r.statusChangedAt) : null,
    });
    const sa = corrected(allergies),
      sm = corrected(medications),
      sv = corrected(vaccinations),
      sf = corrected(family);
    const t = (r: { recordedAt: Date }) => r.recordedAt;
    return {
      allergies: byTime(allergies, t).map((r): AllergyView => ({
        ...base(r, sa),
        kind: r.kind,
        substance: r.substance,
        reaction: r.reaction,
        severity: r.severity,
      })),
      medications: byTime(medications, t).map((r): MedicationHistoryEntry => ({
        ...base(r, sm),
        medicineName: r.medicineName,
        dosage: r.dosage,
        frequency: r.frequency,
        startedOn: day(r.startedOn),
        endedOn: day(r.endedOn),
        notes: r.notes,
      })),
      vaccinations: byTime(vaccinations, t).map((r): VaccinationView => ({
        ...base(r, sv),
        vaccineName: r.vaccineName,
        administeredOn: day(r.administeredOn)!,
        batchNumber: r.batchNumber,
        nextDueOn: day(r.nextDueOn),
      })),
      familyHistory: byTime(family, t).map((r): FamilyHistoryEntry => ({
        ...base(r, sf),
        condition: r.condition,
        present: r.present,
        relation: r.relation,
        notes: r.notes,
      })),
    };
  }

  async addHistory(
    actor: AuthPrincipal,
    patientId: string,
    kind: HistoryKind,
    dto: AllergyDto | MedicationDto | VaccinationDto | FamilyHistoryDto,
  ): Promise<PatientHistory> {
    const p = await this.patientFor(actor, patientId);
    const { supersedesId, correctionReason, ...values } = dto;
    const delegate = this.historyDelegate(kind);
    if (supersedesId) {
      const original = await delegate.findFirst({ where: { id: supersedesId, patientId: p.id } });
      if (!original) throw notFound('entry');
      if (original.status === 'ENTERED_IN_ERROR')
        throw bad(
          'VALIDATION_ERROR',
          'This entry was marked as a mistake and cannot be corrected.',
        );
      if (await delegate.findFirst({ where: { supersedesId } }))
        throw conflict(
          EmrErrorCode.ALREADY_CORRECTED,
          'This entry already has a correction. Correct the newest version instead.',
        );
    }
    const dates = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [
        k,
        typeof v === 'string' && /On$/.test(k) ? new Date(`${v}T00:00:00Z`) : v,
      ]),
    );
    await delegate
      .create({
        data: {
          hospitalId: p.hospitalId,
          patientId: p.id,
          recordedById: actor.userId,
          ...dates,
          supersedesId: supersedesId ?? null,
          correctionReason: supersedesId ? correctionReason! : null,
        } as Prisma.AllergyUncheckedCreateInput,
      })
      .catch((e: unknown) =>
        mapPrismaError(e, {
          conflict:
            kind === 'familyHistory'
              ? 'This condition is already recorded. Correct the existing entry instead.'
              : 'This entry already has a correction.',
        }),
      );
    return this.history(actor, p.id);
  }

  /** RESOLVED (no longer current) or ENTERED_IN_ERROR (a mistake, with reason); both stay visible. */
  async setHistoryStatus(
    actor: AuthPrincipal,
    patientId: string,
    kind: HistoryKind,
    entryId: string,
    dto: HistoryStatusDto,
  ): Promise<PatientHistory> {
    const p = await this.patientFor(actor, patientId);
    const delegate = this.historyDelegate(kind);
    const e = await delegate.findFirst({ where: { id: entryId, patientId: p.id } });
    if (!e) throw notFound('entry');
    if (e.status === 'ENTERED_IN_ERROR')
      throw bad('VALIDATION_ERROR', 'This entry was marked as a mistake and cannot change.');
    if (e.status === dto.status)
      throw bad('VALIDATION_ERROR', 'The entry already has this status.');
    await delegate.update({
      where: { id: e.id },
      data: {
        status: dto.status,
        statusReason: dto.reason ?? null,
        statusChangedById: actor.userId,
        statusChangedAt: new Date(),
      },
    });
    return this.history(actor, p.id);
  }

  async searchIcd10(search: string): Promise<Icd10Code[]> {
    const rows = await this.db.client.icd10Code.findMany({
      where: {
        OR: [
          { code: { startsWith: search.toUpperCase() } },
          { title: { contains: search, mode: 'insensitive' } },
        ],
      },
      orderBy: { code: 'asc' },
      take: 20,
    });
    return rows.map((r) => ({ code: r.code, title: r.title }));
  }

  // ------------------------------------------------------------------ helpers

  private historyDelegate(kind: HistoryKind) {
    // The four history tables share the columns used here; one delegate type keeps the code single-path.
    return this.db.client[HISTORY_MODEL[kind]] as unknown as Prisma.AllergyDelegate;
  }

  private async patientFor(actor: AuthPrincipal, patientId: string) {
    const p = await this.db.client.patient.findFirst({ where: { id: patientId, deletedAt: null } });
    // TEST-011: another patient's id answers 404, exactly as a missing one.
    if (!p || (actor.role === 'PATIENT' && p.userId !== actor.userId)) throw notFound('patient');
    return p;
  }

  private async load(actor: AuthPrincipal, id: string): Promise<RecordRow> {
    const r = await this.db.client.medicalRecord.findFirst({ where: { id }, include });
    if (!r || (actor.role === 'PATIENT' && r.appointment.patient.userId !== actor.userId))
      throw notFound('medical record');
    return r;
  }

  private assertTreating(actor: AuthPrincipal, r: RecordRow): void {
    if (r.appointment.doctor.userId !== actor.userId)
      throw new ForbiddenException({
        code: EmrErrorCode.NOT_TREATING_DOCTOR,
        message: 'Only the doctor who saw the patient can change this record.',
      });
  }

  private async writable(
    actor: AuthPrincipal,
    id: string,
    mustBeOpen: boolean,
  ): Promise<RecordRow> {
    const r = await this.load(actor, id);
    this.assertTreating(actor, r);
    if (mustBeOpen && r.status === 'CLOSED')
      throw conflict(
        EmrErrorCode.RECORD_CLOSED,
        'This consultation is completed. Add an addendum instead.',
      );
    return r;
  }

  /** New rows only while open; a correction must target an uncorrected row of this record. */
  private checkCorrection(
    rows: { id: string; supersedesId: string | null }[],
    dto: { supersedesId?: string },
    status: string,
    what: string,
  ): void {
    if (!dto.supersedesId) {
      if (status === 'CLOSED')
        throw conflict(
          EmrErrorCode.RECORD_CLOSED,
          `This consultation is completed. You can still correct an existing ${what}.`,
        );
      return;
    }
    if (!rows.some((r) => r.id === dto.supersedesId)) throw notFound(what);
    if (rows.some((r) => r.supersedesId === dto.supersedesId))
      throw conflict(
        EmrErrorCode.ALREADY_CORRECTED,
        `This ${what} already has a correction. Correct the newest version instead.`,
      );
  }

  /** Decrypts every encrypted value of the given records in one round trip. */
  private async views(rows: RecordRow[]): Promise<RecordView[]> {
    const cipher: Uint8Array[] = [];
    const slot = (b: Uint8Array | null) => (b ? cipher.push(b) - 1 : -1);
    const plan = rows.map((r) => slot(r.treatmentPlanEnc));
    const entries = rows.map((r) => r.entries.map((e) => slot(e.bodyEnc)));
    const diagnoses = rows.map((r) => r.diagnoses.map((d) => slot(d.descriptionEnc)));
    const plain = await this.crypto.decrypt(cipher);
    const text = (i: number) => (i < 0 ? null : plain[i]!);
    return rows.map((r, ri) => {
      const a = r.appointment;
      const correctedIds = (
        list: { supersedesId?: string | null; amendsEntryId?: string | null }[],
      ) => new Set(list.map((x) => x.supersedesId ?? x.amendsEntryId).filter(Boolean));
      const ce = correctedIds(r.entries),
        cv = correctedIds(r.vitals),
        cd = correctedIds(r.diagnoses);
      const entryText = new Map(r.entries.map((e, i) => [e.id, text(entries[ri]![i]!)!]));
      const diagText = new Map(r.diagnoses.map((d, i) => [d.id, text(diagnoses[ri]![i]!)!]));
      return {
        id: r.id,
        status: r.status,
        chiefComplaint: r.chiefComplaint,
        presentingSymptoms: r.presentingSymptoms,
        treatmentPlan: text(plan[ri]!),
        createdAt: iso(r.createdAt),
        closedAt: r.closedAt ? iso(r.closedAt) : null,
        appointment: { id: a.id, scheduledAt: iso(a.scheduledAt), type: a.type, status: a.status },
        patient: {
          id: a.patient.id,
          firstName: a.patient.user.firstName,
          lastName: a.patient.user.lastName,
          mrn: a.patient.mrn,
          dateOfBirth: day(a.patient.dateOfBirth)!,
          gender: a.patient.gender,
        },
        doctor: {
          id: a.doctor.id,
          userId: a.doctor.userId,
          firstName: a.doctor.user.firstName,
          lastName: a.doctor.user.lastName,
          specialisation: a.doctor.specialisation,
        },
        department: { id: a.department.id, name: a.department.name },
        entries: byTime(r.entries, (e) => e.createdAt).map((e): EntryView => ({
          id: e.id,
          kind: e.kind,
          body: entryText.get(e.id)!,
          by: person(e.author),
          at: iso(e.createdAt),
          supersedesId: e.amendsEntryId,
          correctionReason: e.correctionReason,
          corrected: ce.has(e.id),
        })),
        vitals: byTime(r.vitals, (v) => v.recordedAt).map((v): VitalsView => ({
          id: v.id,
          systolicBp: v.systolicBp,
          diastolicBp: v.diastolicBp,
          pulse: v.pulse,
          temperatureC: n(v.temperatureC),
          spo2: v.spo2,
          heightCm: n(v.heightCm),
          weightKg: n(v.weightKg),
          bmi: bmi(n(v.heightCm), n(v.weightKg)),
          by: person(v.recordedBy),
          at: iso(v.recordedAt),
          supersedesId: v.supersedesId,
          correctionReason: v.correctionReason,
          corrected: cv.has(v.id),
        })),
        diagnoses: byTime(r.diagnoses, (d) => d.createdAt).map((d): DiagnosisView => ({
          id: d.id,
          icd10: d.icd10 ? { code: d.icd10.code, title: d.icd10.title } : null,
          description: diagText.get(d.id)!,
          type: d.type,
          by: person(d.recordedBy),
          at: iso(d.createdAt),
          supersedesId: d.supersedesId,
          correctionReason: d.correctionReason,
          corrected: cd.has(d.id),
        })),
        files: byTime(r.files, (f) => f.createdAt).map((f): ClinicalFile => ({
          id: f.id,
          originalName: f.originalName,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          uploadedBy: {
            id: f.uploadedBy.id,
            firstName: f.uploadedBy.firstName,
            lastName: f.uploadedBy.lastName,
          },
          createdAt: iso(f.createdAt),
        })),
      };
    });
  }
}

type HistoryRow = {
  id: string;
  recordedBy: User;
  recordedAt: Date;
  supersedesId: string | null;
  correctionReason: string | null;
  status: 'ACTIVE' | 'RESOLVED' | 'ENTERED_IN_ERROR';
  statusReason: string | null;
  statusChangedAt: Date | null;
};
