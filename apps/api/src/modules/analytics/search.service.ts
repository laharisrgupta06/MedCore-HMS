import { BadRequestException, Injectable } from '@nestjs/common';
import type { SearchHit, SearchKind, SearchResults } from '@medcore/types';
import type { Prisma, Role } from '@prisma/client';
import type { AuthPrincipal } from '../../common/auth/decorators';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';

const PER_KIND = 5;

/**
 * Who may search what. Each kind mirrors the read rule of the screen it links to, so search never
 * shows a record the role could not open: patients (PATIENT_READERS), doctors (every hospital role),
 * appointments (STAFF_VIEW; doctors their own), invoices (reception, accountant, admin), prescriptions
 * (DOCTOR, NURSE, PHARMACIST), medicines (DOCTOR, PHARMACIST, HOSPITAL_ADMIN). Patients and the
 * platform super admin have no global search.
 */
export const SEARCH_ACCESS: Record<SearchKind, readonly Role[]> = {
  patients: [
    'HOSPITAL_ADMIN',
    'RECEPTIONIST',
    'DOCTOR',
    'NURSE',
    'ACCOUNTANT',
    'LAB_TECHNICIAN',
    'PHARMACIST',
  ],
  doctors: [
    'HOSPITAL_ADMIN',
    'DOCTOR',
    'NURSE',
    'RECEPTIONIST',
    'LAB_TECHNICIAN',
    'PHARMACIST',
    'ACCOUNTANT',
  ],
  appointments: ['HOSPITAL_ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST', 'ACCOUNTANT'],
  invoices: ['RECEPTIONIST', 'ACCOUNTANT', 'HOSPITAL_ADMIN'],
  prescriptions: ['DOCTOR', 'NURSE', 'PHARMACIST'],
  medicines: ['DOCTOR', 'PHARMACIST', 'HOSPITAL_ADMIN'],
};

const ci = (q: string) => ({ contains: q, mode: 'insensitive' as const });
const name = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();

/**
 * Global search (DASH-012). Runs on the tenant client, so every query is limited to the caller's
 * hospital. Results carry names, MRNs, dates and statuses only: no diagnoses, medicines of a
 * prescription, results or amounts (DEC-065 applies to search too).
 */
@Injectable()
export class SearchService {
  constructor(private readonly db: TenantPrismaService) {}

  async search(actor: AuthPrincipal, raw: string, only?: SearchKind[]): Promise<SearchResults> {
    const q = raw.trim();
    if (q.length < 2 || q.length > 80)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Search for 2 to 80 characters.',
      });
    const allowed = (Object.keys(SEARCH_ACCESS) as SearchKind[]).filter(
      (k) => SEARCH_ACCESS[k].includes(actor.role) && (!only?.length || only.includes(k)),
    );
    const tz =
      (
        await this.db.client.hospital.findFirst({
          where: { id: actor.hospitalId! },
          select: { timezone: true },
        })
      )?.timezone ?? 'Asia/Kolkata';
    const when = (d: Date) =>
      new Intl.DateTimeFormat('en-IN', {
        timeZone: tz,
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(d);
    const patientMatch: Prisma.PatientWhereInput = {
      deletedAt: null,
      OR: [{ mrn: ci(q) }, { user: { firstName: ci(q) } }, { user: { lastName: ci(q) } }],
    };
    const take = PER_KIND + 1;

    const run: Record<SearchKind, () => Promise<SearchHit[]>> = {
      patients: async () =>
        (
          await this.db.client.patient.findMany({
            where: patientMatch,
            take,
            orderBy: { createdAt: 'desc' },
            select: { id: true, mrn: true, user: { select: { firstName: true, lastName: true } } },
          })
        ).map((p) => ({
          kind: 'patients',
          id: p.id,
          title: name(p.user),
          subtitle: `MRN ${p.mrn}`,
          href: `/dashboard/patients/${p.id}`,
        })),

      doctors: async () =>
        (
          await this.db.client.doctor.findMany({
            where: {
              deletedAt: null,
              OR: [
                { specialisation: ci(q) },
                { user: { firstName: ci(q) } },
                { user: { lastName: ci(q) } },
              ],
            },
            take,
            select: {
              id: true,
              specialisation: true,
              user: { select: { firstName: true, lastName: true } },
            },
          })
        ).map((d) => ({
          kind: 'doctors',
          id: d.id,
          title: `Dr ${name(d.user)}`,
          subtitle: d.specialisation,
          href: '/dashboard/doctors',
        })),

      appointments: async () => {
        let doctorId: string | undefined;
        if (actor.role === 'DOCTOR')
          doctorId =
            (
              await this.db.client.doctor.findFirst({
                where: { userId: actor.userId },
                select: { id: true },
              })
            )?.id ?? '00000000-0000-4000-8000-000000000000';
        const rows = await this.db.client.appointment.findMany({
          where: { deletedAt: null, patient: patientMatch, ...(doctorId ? { doctorId } : {}) },
          take,
          orderBy: { scheduledAt: 'desc' },
          select: {
            id: true,
            scheduledAt: true,
            status: true,
            patientId: true,
            patient: {
              select: { mrn: true, user: { select: { firstName: true, lastName: true } } },
            },
            doctor: { select: { user: { select: { firstName: true, lastName: true } } } },
          },
        });
        return rows.map((a) => ({
          kind: 'appointments' as const,
          id: a.id,
          title: `${name(a.patient.user)} with Dr ${name(a.doctor.user)}`,
          subtitle: `${when(a.scheduledAt)} · ${a.status.replace(/_/g, ' ').toLowerCase()}`,
          href: SEARCH_ACCESS.patients.includes(actor.role)
            ? `/dashboard/patients/${a.patientId}`
            : '/dashboard/appointments',
        }));
      },

      invoices: async () =>
        (
          await this.db.client.invoice.findMany({
            where: { OR: [{ invoiceNumber: ci(q) }, { patient: patientMatch }] },
            take,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              invoiceNumber: true,
              status: true,
              patient: {
                select: { mrn: true, user: { select: { firstName: true, lastName: true } } },
              },
            },
          })
        ).map((i) => ({
          kind: 'invoices',
          id: i.id,
          title: i.invoiceNumber ?? 'Draft invoice',
          subtitle: `${name(i.patient.user)} (${i.patient.mrn}) · ${i.status.replace(/_/g, ' ').toLowerCase()}`,
          href: `/dashboard/invoices/${i.id}`,
        })),

      prescriptions: async () =>
        (
          await this.db.client.prescription.findMany({
            where: { medicalRecord: { appointment: { patient: patientMatch } } },
            take,
            orderBy: { issuedAt: 'desc' },
            select: {
              id: true,
              status: true,
              issuedAt: true,
              medicalRecord: {
                select: {
                  appointment: {
                    select: {
                      patientId: true,
                      patient: {
                        select: {
                          mrn: true,
                          user: { select: { firstName: true, lastName: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          })
        ).map((p) => {
          const pt = p.medicalRecord.appointment;
          return {
            kind: 'prescriptions' as const,
            id: p.id,
            title: `Prescription for ${name(pt.patient.user)}`,
            subtitle: `${when(p.issuedAt)} · ${p.status.replace(/_/g, ' ').toLowerCase()}`,
            href:
              actor.role === 'PHARMACIST'
                ? `/dashboard/pharmacy/prescriptions/${p.id}`
                : `/dashboard/patients/${pt.patientId}`,
          };
        }),

      medicines: async () =>
        (
          await this.db.client.medicine.findMany({
            where: { OR: [{ name: ci(q) }, { genericName: ci(q) }] },
            take,
            orderBy: { name: 'asc' },
            select: { id: true, name: true, genericName: true, isActive: true },
          })
        ).map((m) => ({
          kind: 'medicines',
          id: m.id,
          title: m.name,
          subtitle:
            [m.genericName, m.isActive ? null : 'inactive'].filter(Boolean).join(' · ') ||
            'Medicine',
          href: '/dashboard/medicines',
        })),
    };

    const groups = await Promise.all(
      allowed.map(async (kind) => {
        const hits = await run[kind]();
        return { kind, hits: hits.slice(0, PER_KIND), more: hits.length > PER_KIND };
      }),
    );
    return { query: q, searched: allowed, groups };
  }
}
