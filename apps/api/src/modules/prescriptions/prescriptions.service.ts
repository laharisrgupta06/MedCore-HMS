import { randomUUID, createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import {
  EmrErrorCode,
  FREQUENCY_LABEL,
  PrescriptionErrorCode,
  type AllergyConflict,
  type Prescription as PrescriptionView,
} from '@medcore/types';
import type { Prisma } from '@prisma/client';
import type { AuthPrincipal } from '../../common/auth/decorators';
import { DomainEvents } from '../../common/events/domain-events';
import { PaginatedResult } from '../../common/http/paginated-result';
import { notFound } from '../../common/http/prisma-errors';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { PDF_JOBS, PdfRenderers, type PdfJob, type PdfJobs } from '../../infra/pdf/pdf-jobs';
import { PdfService } from '../../infra/pdf/pdf.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import type {
  CancelPrescriptionDto,
  IssuePrescriptionDto,
  PrescriptionQuery,
} from './prescriptions.dto';

const include = {
  medicalRecord: {
    include: {
      appointment: {
        include: { doctor: { include: { user: true } }, patient: { include: { user: true } } },
      },
    },
  },
  items: { include: { medicine: true, dispenses: true } },
} as const;
type Row = Prisma.PrescriptionGetPayload<{ include: typeof include }>;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
/** Advisory name match between a recorded allergy and a medicine (name or generic name). */
export function allergyMatches(substance: string, names: (string | null)[]): boolean {
  const a = norm(substance);
  if (a.length < 3) return false;
  return names.some((n) => {
    const b = n ? norm(n) : '';
    return b.length >= 3 && (b.includes(a) || a.includes(b));
  });
}

const toView = (p: Row): PrescriptionView => {
  const a = p.medicalRecord.appointment;
  return {
    id: p.id,
    status: p.status,
    issuedAt: p.issuedAt.toISOString(),
    notes: p.notes,
    medicalRecordId: p.medicalRecordId,
    patient: {
      id: a.patient.id,
      firstName: a.patient.user.firstName,
      lastName: a.patient.user.lastName,
      mrn: a.patient.mrn,
    },
    doctor: {
      id: a.doctor.id,
      userId: a.doctor.userId,
      firstName: a.doctor.user.firstName,
      lastName: a.doctor.user.lastName,
      specialisation: a.doctor.specialisation,
    },
    items: p.items.map((i) => ({
      id: i.id,
      medicine: {
        id: i.medicine.id,
        name: i.medicine.name,
        genericName: i.medicine.genericName,
        form: i.medicine.form,
        strength: i.medicine.strength,
      },
      dosage: i.dosage,
      frequency: i.frequency,
      durationDays: i.durationDays,
      quantity: i.quantity,
      instructions: i.instructions,
      dispensedQuantity: i.dispenses.reduce((s, d) => s + d.quantity, 0),
    })),
    allergyOverrideReason: p.allergyOverrideReason,
    pdfReady: p.pdfFileId !== null,
    verifiedAt: p.verifiedAt?.toISOString() ?? null,
    cancelledAt: p.cancelledAt?.toISOString() ?? null,
    cancellationReason: p.cancellationReason,
  };
};

/**
 * Prescriptions (SCOPE-012, RX-001..008, DEC-040 D3/D4). Issued by the treating doctor while the
 * consultation is open; never edited afterwards; cancelled with a reason only before dispensing.
 * The PDF is built after commit by the pdf queue.
 */
@Injectable()
export class PrescriptionsService implements OnModuleInit {
  private readonly log = new Logger('Prescriptions');

  constructor(
    private readonly db: TenantPrismaService,
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
    private readonly storage: StorageService,
    private readonly pdf: PdfService,
    private readonly renderers: PdfRenderers,
    @Inject(PDF_JOBS) private readonly pdfJobs: PdfJobs,
  ) {}

  onModuleInit(): void {
    this.renderers.register('prescription', (job) => this.renderPdf(job));
  }

  async issue(actor: AuthPrincipal, dto: IssuePrescriptionDto): Promise<PrescriptionView> {
    const r = await this.db.client.medicalRecord.findFirst({
      where: { id: dto.medicalRecordId },
      include: { appointment: { include: { doctor: true } } },
    });
    if (!r) throw notFound('medical record');
    if (r.appointment.doctor.userId !== actor.userId)
      throw new ForbiddenException({
        code: EmrErrorCode.NOT_TREATING_DOCTOR,
        message: 'Only the doctor who saw the patient can prescribe in this consultation.',
      });
    if (r.status === 'CLOSED')
      throw new ConflictException({
        code: EmrErrorCode.RECORD_CLOSED,
        message:
          'This consultation is completed. Prescriptions are issued during the consultation.',
      });
    if (!r.appointment.doctor.signatureFileId)
      throw new BadRequestException({
        code: PrescriptionErrorCode.NO_SIGNATURE,
        message:
          'Upload your signature on the Doctors page before issuing prescriptions; it is printed on the PDF.',
      });
    const ids = dto.items.map((i) => i.medicineId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Each medicine can appear only once. Adjust the dose or quantity instead.',
      });
    const medicines = await this.db.client.medicine.findMany({ where: { id: { in: ids } } });
    for (const id of ids) {
      const m = medicines.find((x) => x.id === id);
      if (!m) throw notFound('medicine');
      if (!m.isActive)
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: `${m.name} ${m.strength} is no longer in use and cannot be prescribed.`,
        });
    }

    // DEC-040 D4: active, uncorrected allergies that match by name need an acknowledged reason.
    const allergies = await this.db.client.allergy.findMany({
      where: { patientId: r.appointment.patientId },
    });
    const corrected = new Set(allergies.map((a) => a.supersedesId).filter(Boolean));
    const conflicts: AllergyConflict[] = [];
    for (const a of allergies.filter((x) => x.status === 'ACTIVE' && !corrected.has(x.id)))
      for (const m of medicines)
        if (allergyMatches(a.substance, [m.name, m.genericName]))
          conflicts.push({
            allergyId: a.id,
            substance: a.substance,
            medicineId: m.id,
            medicineName: `${m.name} ${m.strength}`,
          });
    if (conflicts.length && !dto.allergyOverrideReason)
      throw new ConflictException({
        code: PrescriptionErrorCode.ALLERGY_CONFLICT,
        message: `The patient has a recorded allergy or reaction to ${[...new Set(conflicts.map((c) => c.substance))].join(', ')}. Confirm with a reason to prescribe anyway.`,
        details: { conflicts },
      });

    const id = await this.db.client.$transaction(async (tx) => {
      const p = await tx.prescription.create({
        data: {
          hospitalId: r.hospitalId,
          medicalRecordId: r.id,
          notes: dto.notes || null,
          allergyOverrideReason: conflicts.length ? dto.allergyOverrideReason! : null,
        },
      });
      for (const i of dto.items)
        await tx.prescriptionItem.create({
          data: {
            hospitalId: r.hospitalId,
            prescriptionId: p.id,
            medicineId: i.medicineId,
            dosage: i.dosage,
            frequency: i.frequency,
            durationDays: i.durationDays,
            quantity: i.quantity,
            instructions: i.instructions || null,
          },
        });
      return p.id;
    });
    await this.events.publish({
      type: 'prescription.issued',
      hospitalId: r.hospitalId,
      prescriptionId: id,
    });
    await this.queuePdf(r.hospitalId, id);
    return this.get(actor, id);
  }

  async cancel(
    actor: AuthPrincipal,
    id: string,
    dto: CancelPrescriptionDto,
  ): Promise<PrescriptionView> {
    const p = await this.load(actor, id);
    if (p.medicalRecord.appointment.doctor.userId !== actor.userId)
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only the prescribing doctor can cancel this prescription.',
      });
    if (p.status === 'CANCELLED')
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: 'This prescription is already cancelled.',
      });
    // The status check and the update happen together, so a dispense cannot slip in between.
    const changed = await this.db.client.$transaction(async (tx) => {
      const dispensed = await tx.dispense.count({
        where: { prescriptionItem: { prescriptionId: id } },
      });
      if (dispensed > 0) return 0;
      const u = await tx.prescription.updateMany({
        where: { id, status: 'ISSUED' },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledById: actor.userId,
          cancellationReason: dto.reason,
        },
      });
      return u.count;
    });
    if (!changed)
      throw new ConflictException({
        code: PrescriptionErrorCode.ALREADY_DISPENSED,
        message:
          'The pharmacy has already started dispensing this prescription, so it cannot be cancelled.',
      });
    await this.events.publish({
      type: 'prescription.cancelled',
      hospitalId: p.hospitalId,
      prescriptionId: id,
    });
    return this.get(actor, id);
  }

  async get(actor: AuthPrincipal, id: string): Promise<PrescriptionView> {
    return toView(await this.load(actor, id));
  }

  async list(
    actor: AuthPrincipal,
    q: PrescriptionQuery,
  ): Promise<PaginatedResult<PrescriptionView>> {
    const where: Prisma.PrescriptionWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.medicalRecordId ? { medicalRecordId: q.medicalRecordId } : {}),
      ...(q.patientId ? { medicalRecord: { appointment: { patientId: q.patientId } } } : {}),
      ...(actor.role === 'PATIENT'
        ? { AND: [{ medicalRecord: { appointment: { patient: { userId: actor.userId } } } }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.client.prescription.findMany({
        where,
        include,
        orderBy: { issuedAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.db.client.prescription.count({ where }),
    ]);
    return PaginatedResult.of(rows.map(toView), total, q.page, q.limit);
  }

  async pdfFile(actor: AuthPrincipal, id: string): Promise<{ name: string; data: Buffer }> {
    const p = await this.load(actor, id);
    if (!p.pdfFileId)
      throw new ConflictException({
        code: PrescriptionErrorCode.PDF_PENDING,
        message: 'The PDF is still being prepared. Try again in a moment.',
      });
    const f = await this.db.client.fileAttachment.findFirst({ where: { id: p.pdfFileId } });
    if (!f) throw notFound('file');
    return {
      name: `prescription-${p.id.slice(0, 8)}.pdf`,
      data: await this.storage.get(f.storageKey),
    };
  }

  async retryPdf(actor: AuthPrincipal, id: string): Promise<PrescriptionView> {
    const p = await this.load(actor, id);
    if (p.medicalRecord.appointment.doctor.userId !== actor.userId)
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only the prescribing doctor can request the PDF again.',
      });
    if (p.pdfFileId)
      throw new ConflictException({
        code: PrescriptionErrorCode.PDF_READY,
        message: 'The PDF is already available.',
      });
    await this.pdfJobs.enqueue({ kind: 'prescription', id, hospitalId: p.hospitalId });
    return this.get(actor, id);
  }

  private async queuePdf(hospitalId: string, id: string): Promise<void> {
    try {
      await this.pdfJobs.enqueue({ kind: 'prescription', id, hospitalId });
    } catch (e) {
      // The prescription stands; the doctor can request the PDF again (POST /prescriptions/:id/pdf).
      this.log.error(`Could not queue the PDF for prescription ${id}: ${(e as Error).message}`);
    }
  }

  private async load(actor: AuthPrincipal, id: string): Promise<Row> {
    const p = await this.db.client.prescription.findFirst({ where: { id }, include });
    // TEST-011 style: another patient's prescription answers 404.
    if (
      !p ||
      (actor.role === 'PATIENT' && p.medicalRecord.appointment.patient.userId !== actor.userId)
    )
      throw notFound('prescription');
    return p;
  }

  /** Runs in the pdf worker (no request context): every query names the hospital explicitly. */
  async renderPdf(job: PdfJob): Promise<void> {
    const p = await this.prisma.prescription.findFirst({
      where: { id: job.id, hospitalId: job.hospitalId },
      include: { ...include, hospital: { include: { address: true } } },
    });
    if (!p || p.pdfFileId) return;
    const a = p.medicalRecord.appointment;
    const signature = a.doctor.signatureFileId
      ? await this.prisma.fileAttachment.findFirst({
          where: { id: a.doctor.signatureFileId, hospitalId: job.hospitalId },
        })
      : null;
    const sigImage = signature
      ? await this.storage.get(signature.storageKey).catch(() => null)
      : null;
    const h = p.hospital;
    const tz = h.timezone;
    const when = new Intl.DateTimeFormat('en-IN', {
      timeZone: tz,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(p.issuedAt);
    const dob = a.patient.dateOfBirth;
    const now = new Date();
    const age =
      now.getUTCFullYear() -
      dob.getUTCFullYear() -
      (now < new Date(Date.UTC(now.getUTCFullYear(), dob.getUTCMonth(), dob.getUTCDate())) ? 1 : 0);
    const addr = h.address;
    const buf = await this.pdf.render('Prescription', (doc) => {
      this.pdf.letterhead(doc, {
        name: h.name,
        addressLines: addr
          ? [
              [addr.line1, addr.line2].filter(Boolean).join(', '),
              `${addr.city}, ${addr.state} ${addr.postalCode}`,
            ]
          : [],
        phone: h.phone,
        email: h.email,
        licenseNumber: h.licenseNumber,
      });
      doc.font('Helvetica-Bold').fontSize(13).text('Prescription');
      doc.font('Helvetica').fontSize(8.5).fillColor('#5F665F').text(`Rx ${p.id} · issued ${when}`);
      doc.fillColor('#1E2420').moveDown(0.6);
      this.pdf.facts(doc, [
        ['Patient', `${a.patient.user.firstName} ${a.patient.user.lastName}`],
        ['MRN', a.patient.mrn],
        ['Age and gender', `${age} years, ${a.patient.gender.toLowerCase()}`],
        [
          'Doctor',
          `Dr ${a.doctor.user.firstName} ${a.doctor.user.lastName}, ${a.doctor.specialisation}`,
        ],
        ['Registration number', a.doctor.registrationNumber],
        ['Consultation', p.medicalRecord.chiefComplaint],
      ]);
      doc.moveDown(0.4);
      this.pdf.table(
        doc,
        [
          { header: '#', width: 22 },
          { header: 'Medicine', width: 150 },
          { header: 'Dose', width: 60 },
          { header: 'Frequency', width: 84 },
          { header: 'Days', width: 36, align: 'right' },
          { header: 'Qty', width: 40, align: 'right' },
          { header: 'Instructions', width: 107 },
        ],
        p.items.map((i, n) => [
          String(n + 1),
          `${i.medicine.name} ${i.medicine.strength} (${i.medicine.form.toLowerCase()})${i.medicine.genericName ? `\n${i.medicine.genericName}` : ''}`,
          i.dosage,
          `${i.frequency} (${FREQUENCY_LABEL[i.frequency].toLowerCase()})`,
          String(i.durationDays),
          String(i.quantity),
          i.instructions ?? '',
        ]),
      );
      if (p.notes)
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .text('Notes')
          .font('Helvetica')
          .fontSize(9.5)
          .text(p.notes)
          .moveDown(0.6);
      if (p.allergyOverrideReason)
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor('#C8432B')
          .text('Allergy acknowledged by the doctor')
          .font('Helvetica')
          .fillColor('#1E2420')
          .fontSize(9.5)
          .text(p.allergyOverrideReason)
          .moveDown(0.6);
      const x = doc.page.width - doc.page.margins.right - 180;
      if (doc.y + 110 > doc.page.height - doc.page.margins.bottom) doc.addPage();
      const y = doc.y + 12;
      if (sigImage) doc.image(sigImage, x, y, { fit: [180, 60] });
      doc
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .text(`Dr ${a.doctor.user.firstName} ${a.doctor.user.lastName}`, x, y + 66, { width: 180 });
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor('#5F665F')
        .text(`Reg. ${a.doctor.registrationNumber} · digitally signed`, x, doc.y, { width: 180 });
    });
    const key = `${job.hospitalId}/prescriptions/${p.id}-${randomUUID()}.pdf`;
    await this.storage.put(key, buf);
    await this.prisma.$transaction(async (tx) => {
      const f = await tx.fileAttachment.create({
        data: {
          hospitalId: job.hospitalId,
          patientId: a.patientId,
          medicalRecordId: p.medicalRecordId,
          purpose: 'PRESCRIPTION_PDF',
          storageKey: key,
          originalName: `prescription-${p.id.slice(0, 8)}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: buf.length,
          sha256: createHash('sha256').update(buf).digest('hex'),
          uploadedById: a.doctor.userId,
        },
      });
      await tx.prescription.update({ where: { id: p.id }, data: { pdfFileId: f.id } });
    });
  }
}
