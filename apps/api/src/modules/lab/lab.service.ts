import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  AppointmentErrorCode,
  EmrErrorCode,
  LabErrorCode,
  ageInYears,
  flagFor,
  selectRange,
  type LabOrder as LabOrderView,
  type LabRange,
  type LabTest as LabTestView,
  type RangeGender,
} from '@medcore/types';
import { Prisma, type LabTestRange, type User } from '@prisma/client';
import type { AuthPrincipal } from '../../common/auth/decorators';
import { DomainEvents } from '../../common/events/domain-events';
import { PaginatedResult } from '../../common/http/paginated-result';
import { mapPrismaError, notFound } from '../../common/http/prisma-errors';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { PdfService } from '../../infra/pdf/pdf.service';
import { StorageService } from '../../infra/storage/storage.service';
import type {
  CreateLabOrderDto,
  LabOrderQuery,
  LabRangeDto,
  LabTestDto,
  LabTestQuery,
  ReasonDto,
  ResultsDto,
  UpdateLabTestDto,
} from './lab.dto';

const bad = (code: string, message: string) => new BadRequestException({ code, message });
const transition = (message: string) =>
  new ConflictException({ code: AppointmentErrorCode.INVALID_TRANSITION, message });
const n = (v: Prisma.Decimal | null) => (v == null ? null : Number(v));
const person = (u: User | null) =>
  u ? { id: u.id, firstName: u.firstName, lastName: u.lastName } : null;
const toRange = (r: LabTestRange): LabRange => ({
  gender: r.gender,
  ageMinYears: r.ageMinYears,
  ageMaxYears: r.ageMaxYears,
  low: Number(r.low),
  high: Number(r.high),
});

const orderInclude = {
  medicalRecord: {
    include: { appointment: { include: { patient: { include: { user: true } }, doctor: true } } },
  },
  orderedBy: true,
  sampleCollectedBy: true,
  approvedBy: true,
  rejectedBy: true,
  items: { include: { labTest: true, result: { include: { enteredBy: true } } } },
} as const;
type OrderRow = Prisma.LabOrderGetPayload<{ include: typeof orderInclude }>;

/**
 * Laboratory (SCOPE-013, LAB-001..007). Status machine: ORDERED → SAMPLE_COLLECTED → PROCESSING →
 * RESULT_UPLOADED → APPROVED, RESULT_UPLOADED → REJECTED → RESULT_UPLOADED (D7), ORDERED →
 * CANCELLED. Values are visible to the lab at every step and to doctors, nurses and the patient
 * only once APPROVED (LAB-005). Approval needs a senior technician who entered none of the results
 * (LAB-004). Approved orders are locked by database triggers; corrections are amended orders.
 */
@Injectable()
export class LabService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly events: DomainEvents,
    private readonly storage: StorageService,
    private readonly pdf: PdfService,
  ) {}

  // ------------------------------------------------------------------ catalogue

  private testView = (t: Prisma.LabTestGetPayload<{ include: { ranges: true } }>): LabTestView => ({
    id: t.id,
    code: t.code,
    name: t.name,
    category: t.category,
    unit: t.unit,
    sampleType: t.sampleType,
    price: t.price.toFixed(2),
    isActive: t.isActive,
    ranges: t.ranges.map(toRange),
  });

  private checkRanges(ranges: LabRangeDto[] | undefined, category: string): void {
    if (!ranges?.length) return;
    if (category === 'RADIOLOGY')
      throw bad(
        'VALIDATION_ERROR',
        'Radiology tests are reported as text or a PDF and have no numeric ranges.',
      );
    for (const r of ranges) {
      if (r.low > r.high)
        throw bad(
          'VALIDATION_ERROR',
          'Each range needs a low value no higher than its high value.',
        );
      if (r.ageMinYears != null && r.ageMaxYears != null && r.ageMinYears > r.ageMaxYears)
        throw bad('VALIDATION_ERROR', 'Age from must not be after age to.');
    }
  }

  async listTests(q: LabTestQuery): Promise<PaginatedResult<LabTestView>> {
    const where: Prisma.LabTestWhereInput = {
      ...(q.active === undefined ? { isActive: true } : { isActive: q.active }),
      ...(q.category ? { category: q.category } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { code: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.client.labTest.findMany({
        where,
        include: { ranges: true },
        orderBy: { name: 'asc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.db.client.labTest.count({ where }),
    ]);
    return PaginatedResult.of(rows.map(this.testView), total, q.page, q.limit);
  }

  async createTest(actor: AuthPrincipal, dto: LabTestDto): Promise<LabTestView> {
    this.checkRanges(dto.ranges, dto.category);
    const hospitalId = actor.hospitalId!;
    const id = await this.db.client
      .$transaction(async (tx) => {
        const t = await tx.labTest.create({
          data: {
            hospitalId,
            code: dto.code,
            name: dto.name,
            category: dto.category,
            unit: dto.unit || null,
            sampleType: dto.sampleType || null,
            price: dto.price,
          },
        });
        for (const r of dto.ranges ?? [])
          await tx.labTestRange.create({
            data: {
              hospitalId,
              labTestId: t.id,
              gender: r.gender ?? null,
              ageMinYears: r.ageMinYears ?? null,
              ageMaxYears: r.ageMaxYears ?? null,
              low: r.low,
              high: r.high,
            },
          });
        return t.id;
      })
      .catch((e) => mapPrismaError(e, { conflict: 'A test with this code already exists.' }));
    return this.testView(
      (await this.db.client.labTest.findFirst({ where: { id }, include: { ranges: true } }))!,
    );
  }

  async updateTest(id: string, dto: UpdateLabTestDto): Promise<LabTestView> {
    const t = await this.db.client.labTest.findFirst({ where: { id } });
    if (!t) throw notFound('lab test');
    this.checkRanges(dto.ranges, t.category);
    const { ranges, ...fields } = dto;
    await this.db.client.$transaction(async (tx) => {
      await tx.labTest.update({
        where: { id },
        data: {
          ...fields,
          ...(fields.unit !== undefined ? { unit: fields.unit || null } : {}),
          ...(fields.sampleType !== undefined ? { sampleType: fields.sampleType || null } : {}),
        },
      });
      if (ranges) {
        // Results keep the range they were judged against (D8), so ranges can be replaced.
        await tx.labTestRange.deleteMany({ where: { labTestId: id } });
        for (const r of ranges)
          await tx.labTestRange.create({
            data: {
              hospitalId: t.hospitalId,
              labTestId: id,
              gender: r.gender ?? null,
              ageMinYears: r.ageMinYears ?? null,
              ageMaxYears: r.ageMaxYears ?? null,
              low: r.low,
              high: r.high,
            },
          });
      }
    });
    return this.testView(
      (await this.db.client.labTest.findFirst({ where: { id }, include: { ranges: true } }))!,
    );
  }

  // ------------------------------------------------------------------ orders

  async create(actor: AuthPrincipal, dto: CreateLabOrderDto): Promise<LabOrderView> {
    const r = await this.db.client.medicalRecord.findFirst({
      where: { id: dto.medicalRecordId },
      include: { appointment: { include: { doctor: true } } },
    });
    if (!r) throw notFound('medical record');
    if (r.appointment.doctor.userId !== actor.userId)
      throw new ForbiddenException({
        code: EmrErrorCode.NOT_TREATING_DOCTOR,
        message: 'Only the doctor who saw the patient can order tests in this consultation.',
      });
    if (r.status === 'CLOSED')
      throw new ConflictException({
        code: EmrErrorCode.RECORD_CLOSED,
        message: 'This consultation is completed. Tests are ordered during the consultation.',
      });
    if (new Set(dto.testIds).size !== dto.testIds.length)
      throw bad('VALIDATION_ERROR', 'Each test can be ordered once per order.');
    const tests = await this.db.client.labTest.findMany({ where: { id: { in: dto.testIds } } });
    for (const id of dto.testIds) {
      const t = tests.find((x) => x.id === id);
      if (!t) throw notFound('lab test');
      if (!t.isActive) throw bad('VALIDATION_ERROR', `${t.name} is no longer offered.`);
    }
    const id = await this.db.client.$transaction(async (tx) => {
      const o = await tx.labOrder.create({
        data: {
          hospitalId: r.hospitalId,
          medicalRecordId: r.id,
          orderedById: actor.userId,
          priority: dto.priority ?? 'ROUTINE',
          clinicalNotes: dto.clinicalNotes || null,
        },
      });
      for (const testId of dto.testIds)
        await tx.labOrderItem.create({
          data: { hospitalId: r.hospitalId, labOrderId: o.id, labTestId: testId },
        });
      return o.id;
    });
    return this.get(actor, id);
  }

  async list(actor: AuthPrincipal, q: LabOrderQuery): Promise<PaginatedResult<LabOrderView>> {
    const patient = actor.role === 'PATIENT';
    const where: Prisma.LabOrderWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.priority ? { priority: q.priority } : {}),
      ...(q.medicalRecordId ? { medicalRecordId: q.medicalRecordId } : {}),
      ...(q.patientId ? { medicalRecord: { appointment: { patientId: q.patientId } } } : {}),
      ...(q.mine && actor.role === 'DOCTOR' ? { orderedById: actor.userId } : {}),
      // LAB-005: patients see their own orders, and only approved reports.
      ...(patient
        ? {
            status: 'APPROVED',
            AND: [{ medicalRecord: { appointment: { patient: { userId: actor.userId } } } }],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.client.labOrder.findMany({
        where,
        include: orderInclude,
        orderBy: [{ priority: 'desc' }, { createdAt: patient ? 'desc' : 'asc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.db.client.labOrder.count({ where }),
    ]);
    return PaginatedResult.of(
      rows.map((o) => this.view(actor, o)),
      total,
      q.page,
      q.limit,
    );
  }

  async get(actor: AuthPrincipal, id: string): Promise<LabOrderView> {
    return this.view(actor, await this.load(actor, id));
  }

  async cancel(actor: AuthPrincipal, id: string, dto: ReasonDto): Promise<LabOrderView> {
    const o = await this.load(actor, id);
    if (o.orderedById !== actor.userId)
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only the doctor who placed the order can cancel it.',
      });
    await this.move(
      o,
      ['ORDERED'],
      'Only orders whose sample has not been collected can be cancelled.',
      {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledById: actor.userId,
        cancellationReason: dto.reason,
      },
    );
    return this.get(actor, id);
  }

  async collectSample(actor: AuthPrincipal, id: string): Promise<LabOrderView> {
    const o = await this.load(actor, id);
    await this.move(o, ['ORDERED'], 'The sample for this order is already recorded.', {
      status: 'SAMPLE_COLLECTED',
      sampleCollectedAt: new Date(),
      sampleCollectedById: actor.userId,
    });
    return this.get(actor, id);
  }

  async startProcessing(actor: AuthPrincipal, id: string): Promise<LabOrderView> {
    const o = await this.load(actor, id);
    await this.move(o, ['SAMPLE_COLLECTED'], 'Record the sample collection first.', {
      status: 'PROCESSING',
    });
    return this.get(actor, id);
  }

  /** LAB-003/006: structured values with server-side flags and a copied range; optional submit. */
  async enterResults(actor: AuthPrincipal, id: string, dto: ResultsDto): Promise<LabOrderView> {
    const o = await this.load(actor, id);
    if (!['PROCESSING', 'REJECTED'].includes(o.status))
      throw transition(
        'Results can be entered while the order is being processed or after it was sent back.',
      );
    const p = o.medicalRecord.appointment.patient;
    const age = ageInYears(p.dateOfBirth.toISOString());
    const ranges = await this.db.client.labTestRange.findMany({
      where: { labTestId: { in: o.items.map((i) => i.labTestId) } },
    });
    await this.db.client.$transaction(async (tx) => {
      for (const v of dto.results) {
        const item = o.items.find((i) => i.id === v.itemId);
        if (!item) throw notFound('order item');
        const hasNumber = v.valueNumeric !== undefined && v.valueNumeric !== null;
        const text = v.valueText?.trim() || null;
        if (!hasNumber && !text)
          throw bad('VALIDATION_ERROR', `Enter a value or findings for ${item.labTest.name}.`);
        if (item.labTest.category === 'RADIOLOGY' && hasNumber)
          throw bad(
            'VALIDATION_ERROR',
            `${item.labTest.name} is reported as findings text, not a number.`,
          );
        const range = hasNumber
          ? selectRange(
              ranges.filter((r) => r.labTestId === item.labTestId).map(toRange),
              p.gender as RangeGender,
              age,
            )
          : null;
        const data = {
          valueNumeric: hasNumber ? v.valueNumeric! : null,
          valueText: text,
          flag: hasNumber ? flagFor(v.valueNumeric!, range) : null,
          unit: item.labTest.unit,
          referenceLow: range?.low ?? null,
          referenceHigh: range?.high ?? null,
          enteredById: actor.userId,
          enteredAt: new Date(),
        };
        if (item.result) await tx.labResult.update({ where: { id: item.result.id }, data });
        else
          await tx.labResult.create({
            data: { hospitalId: o.hospitalId, labOrderItemId: item.id, ...data },
          });
      }
    });
    if (dto.submit) {
      const fresh = await this.load(actor, id);
      const missing = fresh.items.filter((i) => !i.result);
      if (missing.length && !fresh.reportFileId)
        throw bad(
          LabErrorCode.RESULTS_INCOMPLETE,
          `Enter results for ${missing.map((i) => i.labTest.name).join(', ')}, or attach a report, before sending for approval.`,
        );
      await this.move(
        fresh,
        ['PROCESSING', 'REJECTED'],
        'This order cannot be sent for approval now.',
        { status: 'RESULT_UPLOADED' },
      );
    }
    return this.get(actor, id);
  }

  /** LAB-003: the technician's PDF report (radiology or an analyser printout), content-checked. */
  async attachReport(
    actor: AuthPrincipal,
    id: string,
    file: { originalname: string; size: number; buffer: Buffer } | undefined,
  ): Promise<LabOrderView> {
    const o = await this.load(actor, id);
    if (!['PROCESSING', 'REJECTED'].includes(o.status))
      throw transition(
        'A report can be attached while the order is being processed or after it was sent back.',
      );
    if (!file) throw bad('VALIDATION_ERROR', 'Attach the report as the "file" field.');
    if (file.size === 0 || file.size > 20 * 1024 * 1024)
      throw bad('FILE_REJECTED', 'Reports must be PDF files up to 20 MB.');
    if (
      file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-' ||
      !file.originalname.toLowerCase().endsWith('.pdf')
    )
      throw bad(
        'FILE_REJECTED',
        'Only PDF reports are accepted, and the file name must end in .pdf.',
      );
    const key = `${o.hospitalId}/lab/${o.id}/${randomUUID()}.pdf`;
    await this.storage.put(key, file.buffer);
    await this.db.client.$transaction(async (tx) => {
      const f = await tx.fileAttachment.create({
        data: {
          hospitalId: o.hospitalId,
          patientId: o.medicalRecord.appointment.patientId,
          medicalRecordId: o.medicalRecordId,
          purpose: 'LAB_REPORT',
          storageKey: key,
          originalName: file.originalname.replace(/[^\w.\- ()]/g, '_').slice(0, 200),
          mimeType: 'application/pdf',
          sizeBytes: file.size,
          sha256: createHash('sha256').update(file.buffer).digest('hex'),
          uploadedById: actor.userId,
        },
      });
      await tx.labOrder.update({ where: { id: o.id }, data: { reportFileId: f.id } });
    });
    return this.get(actor, id);
  }

  /** LAB-004: a senior technician who entered none of the results. */
  private async assertReviewer(actor: AuthPrincipal, o: OrderRow): Promise<void> {
    const profile = await this.db.client.staffProfile.findFirst({
      where: { userId: actor.userId },
    });
    if (!profile?.isSeniorLabTechnician)
      throw new ForbiddenException({
        code: LabErrorCode.NOT_SENIOR,
        message: 'Only a senior lab technician can review reports.',
      });
    if (o.items.some((i) => i.result?.enteredById === actor.userId))
      throw new ForbiddenException({
        code: LabErrorCode.SELF_APPROVAL,
        message: 'You entered results on this order, so another senior technician must review it.',
      });
  }

  async approve(actor: AuthPrincipal, id: string): Promise<LabOrderView> {
    const o = await this.load(actor, id);
    await this.assertReviewer(actor, o);
    await this.move(o, ['RESULT_UPLOADED'], 'Only reports waiting for review can be approved.', {
      status: 'APPROVED',
      approvedAt: new Date(),
      approvedById: actor.userId,
    });
    await this.events.publish({
      type: 'lab.report.approved',
      hospitalId: o.hospitalId,
      labOrderId: o.id,
    });
    return this.get(actor, id);
  }

  async reject(actor: AuthPrincipal, id: string, dto: ReasonDto): Promise<LabOrderView> {
    const o = await this.load(actor, id);
    await this.assertReviewer(actor, o);
    await this.move(o, ['RESULT_UPLOADED'], 'Only reports waiting for review can be sent back.', {
      status: 'REJECTED',
      rejectedAt: new Date(),
      rejectedById: actor.userId,
      rejectionReason: dto.reason,
    });
    return this.get(actor, id);
  }

  /** Corrects an APPROVED report: a new order for the same tests; the original stays as it was. */
  async amend(actor: AuthPrincipal, id: string, dto: ReasonDto): Promise<LabOrderView> {
    const o = await this.load(actor, id);
    const profile = await this.db.client.staffProfile.findFirst({
      where: { userId: actor.userId },
    });
    if (!profile?.isSeniorLabTechnician)
      throw new ForbiddenException({
        code: LabErrorCode.NOT_SENIOR,
        message: 'Only a senior lab technician can amend an approved report.',
      });
    if (o.status !== 'APPROVED')
      throw transition(
        'Only approved reports are amended; others can still be corrected directly.',
      );
    const newId = await this.db.client
      .$transaction(async (tx) => {
        const a = await tx.labOrder.create({
          data: {
            hospitalId: o.hospitalId,
            medicalRecordId: o.medicalRecordId,
            orderedById: o.orderedById,
            priority: o.priority,
            clinicalNotes: o.clinicalNotes,
            status: 'PROCESSING',
            sampleCollectedAt: o.sampleCollectedAt,
            sampleCollectedById: o.sampleCollectedById,
            amendsLabOrderId: o.id,
            amendmentReason: dto.reason,
          },
        });
        for (const i of o.items)
          await tx.labOrderItem.create({
            data: { hospitalId: o.hospitalId, labOrderId: a.id, labTestId: i.labTestId },
          });
        return a.id;
      })
      .catch((e) =>
        mapPrismaError(e, {
          conflict: 'This report has already been amended. Amend the newest version.',
        }),
      );
    return this.get(actor, newId);
  }

  /** LAB-005/006: the approved report as a PDF, out-of-range values in tomato and written as HIGH or LOW. */
  async reportPdf(actor: AuthPrincipal, id: string): Promise<{ name: string; data: Buffer }> {
    const o = await this.load(actor, id);
    if (o.status !== 'APPROVED')
      throw new ForbiddenException({
        code: LabErrorCode.NOT_APPROVED,
        message: 'The report is available once a senior technician approves it.',
      });
    const h = await this.db.client.hospital.findFirst({
      where: { id: o.hospitalId },
      include: { address: true },
    });
    const tz = h?.timezone ?? 'Asia/Kolkata';
    const fmt = (d: Date | null) =>
      d
        ? new Intl.DateTimeFormat('en-IN', {
            timeZone: tz,
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(d)
        : '';
    const p = o.medicalRecord.appointment.patient;
    const rows = o.items.map((i) => {
      const r = i.result;
      const ref =
        r && r.referenceLow != null
          ? `${Number(r.referenceLow)} to ${Number(r.referenceHigh)}`
          : r?.valueNumeric != null
            ? 'no reference range'
            : '';
      return [
        i.labTest.name,
        r
          ? r.valueNumeric != null
            ? String(Number(r.valueNumeric))
            : (r.valueText ?? '')
          : 'see attached report',
        r?.unit ?? i.labTest.unit ?? '',
        ref,
        r?.flag && r.flag !== 'NORMAL' ? r.flag : r?.flag ? 'Normal' : '',
      ];
    });
    const flagged = (ri: number) => {
      const f = o.items.at(ri)?.result?.flag;
      return f === 'HIGH' || f === 'LOW';
    };
    const addr = h?.address;
    const data = await this.pdf.render('Laboratory report', (doc) => {
      this.pdf.letterhead(doc, {
        name: h?.name ?? '',
        addressLines: addr
          ? [
              [addr.line1, addr.line2].filter(Boolean).join(', '),
              `${addr.city}, ${addr.state} ${addr.postalCode}`,
            ]
          : [],
        phone: h?.phone ?? '',
        email: h?.email ?? '',
        licenseNumber: h?.licenseNumber ?? '',
      });
      doc
        .font('Helvetica-Bold')
        .fontSize(13)
        .text(o.amendsLabOrderId ? 'Laboratory report (amended)' : 'Laboratory report');
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor('#5F665F')
        .text(`Order ${o.id}`)
        .fillColor('#1E2420')
        .moveDown(0.6);
      this.pdf.facts(doc, [
        ['Patient', `${p.user.firstName} ${p.user.lastName}`],
        ['MRN', p.mrn],
        [
          'Age and gender',
          `${ageInYears(p.dateOfBirth.toISOString())} years, ${p.gender.toLowerCase()}`,
        ],
        ['Ordered by', `Dr ${o.orderedBy.firstName} ${o.orderedBy.lastName}`],
        ['Sample collected', fmt(o.sampleCollectedAt)],
        [
          'Approved',
          `${fmt(o.approvedAt)} by ${o.approvedBy?.firstName ?? ''} ${o.approvedBy?.lastName ?? ''}`,
        ],
      ]);
      if (o.amendmentReason)
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .text('Amendment')
          .font('Helvetica')
          .fontSize(9.5)
          .text(o.amendmentReason)
          .moveDown(0.5);
      this.pdf.table(
        doc,
        [
          { header: 'Test', width: 160 },
          { header: 'Result', width: 120 },
          { header: 'Unit', width: 60 },
          { header: 'Reference', width: 100 },
          { header: 'Flag', width: 59 },
        ],
        rows,
        (ri, ci) => (flagged(ri) && (ci === 1 || ci === 4) ? '#C8432B' : undefined),
      );
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor('#5F665F')
        .text(
          'Values outside the reference range are marked HIGH or LOW. Ranges are those in force when each result was entered.',
        );
    });
    return { name: `lab-report-${o.id.slice(0, 8)}.pdf`, data };
  }

  async reportFile(actor: AuthPrincipal, id: string): Promise<{ name: string; data: Buffer }> {
    const o = await this.load(actor, id);
    if (actor.role !== 'LAB_TECHNICIAN' && o.status !== 'APPROVED')
      throw new ForbiddenException({
        code: LabErrorCode.NOT_APPROVED,
        message: 'The report is available once a senior technician approves it.',
      });
    if (!o.reportFileId) throw notFound('report file');
    const f = await this.db.client.fileAttachment.findFirst({ where: { id: o.reportFileId } });
    if (!f) throw notFound('report file');
    return { name: f.originalName, data: await this.storage.get(f.storageKey) };
  }

  // ------------------------------------------------------------------ helpers

  private async load(actor: AuthPrincipal, id: string): Promise<OrderRow> {
    const o = await this.db.client.labOrder.findFirst({ where: { id }, include: orderInclude });
    // TEST-011 style: other patients' orders, and unapproved ones, answer 404 to a patient.
    if (
      !o ||
      (actor.role === 'PATIENT' &&
        (o.medicalRecord.appointment.patient.userId !== actor.userId || o.status !== 'APPROVED'))
    )
      throw notFound('lab order');
    return o;
  }

  /** Conditional update: the status must still be one of `from`, so two people cannot both move it. */
  private async move(
    o: OrderRow,
    from: string[],
    message: string,
    data: Prisma.LabOrderUncheckedUpdateManyInput,
  ): Promise<void> {
    if (!from.includes(o.status)) throw transition(message);
    const u = await this.db.client.labOrder.updateMany({
      where: { id: o.id, status: { in: from as never } },
      data,
    });
    if (u.count === 0) throw transition(message);
  }

  private view(actor: AuthPrincipal, o: OrderRow): LabOrderView {
    const p = o.medicalRecord.appointment.patient;
    // Lab staff always; clinicians and the patient once approved; reception never (status only).
    const visible =
      actor.role === 'LAB_TECHNICIAN' ||
      (o.status === 'APPROVED' && ['DOCTOR', 'NURSE', 'PATIENT'].includes(actor.role));
    return {
      id: o.id,
      status: o.status,
      priority: o.priority,
      clinicalNotes: o.clinicalNotes,
      createdAt: o.createdAt.toISOString(),
      medicalRecordId: o.medicalRecordId,
      patient: {
        id: p.id,
        firstName: p.user.firstName,
        lastName: p.user.lastName,
        mrn: p.mrn,
        dateOfBirth: p.dateOfBirth.toISOString().slice(0, 10),
        gender: p.gender as RangeGender,
      },
      orderedBy: person(o.orderedBy)!,
      sampleCollectedAt: o.sampleCollectedAt?.toISOString() ?? null,
      sampleCollectedBy: person(o.sampleCollectedBy),
      approvedAt: o.approvedAt?.toISOString() ?? null,
      approvedBy: person(o.approvedBy),
      rejectedAt: o.rejectedAt?.toISOString() ?? null,
      rejectedBy: person(o.rejectedBy),
      rejectionReason: o.rejectionReason,
      cancelledAt: o.cancelledAt?.toISOString() ?? null,
      cancellationReason: o.cancellationReason,
      amendsLabOrderId: o.amendsLabOrderId,
      amendmentReason: o.amendmentReason,
      hasReportFile: o.reportFileId !== null,
      resultsVisible: visible,
      items: o.items.map((i) => ({
        id: i.id,
        test: {
          id: i.labTest.id,
          code: i.labTest.code,
          name: i.labTest.name,
          category: i.labTest.category,
          unit: i.labTest.unit,
          sampleType: i.labTest.sampleType,
        },
        result:
          visible && i.result
            ? {
                valueNumeric: n(i.result.valueNumeric),
                valueText: i.result.valueText,
                flag: i.result.flag,
                unit: i.result.unit,
                referenceLow: n(i.result.referenceLow),
                referenceHigh: n(i.result.referenceHigh),
                enteredBy: person(i.result.enteredBy)!,
                enteredAt: i.result.enteredAt.toISOString(),
              }
            : null,
      })),
    };
  }
}
