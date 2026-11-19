import { ConflictException, Injectable } from '@nestjs/common';
import { TaxErrorCode, type Hospital as HospitalDto } from '@medcore/types';
import type { Hospital, Prisma } from '@prisma/client';
import { SessionStore } from '../../common/auth/session.store';
import { PaginatedResult } from '../../common/http/paginated-result';
import { mapPrismaError, notFound } from '../../common/http/prisma-errors';
import { skipTake } from '../../common/dto/fields';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { AuthService } from '../auth/auth.service';
import type { CreateHospitalDto, ListHospitalsQuery, UpdateHospitalDto } from './hospitals.dto';

function timezoneLocked(): ConflictException {
  return new ConflictException({
    code: TaxErrorCode.TIMEZONE_LOCKED,
    message:
      'The time zone is locked because tax settings already use it. A correction needs a reviewed database migration.',
  });
}

export function toHospital(h: Hospital): HospitalDto {
  return {
    id: h.id,
    name: h.name,
    code: h.code,
    email: h.email,
    phone: h.phone,
    licenseNumber: h.licenseNumber,
    status: h.status,
    verifiedAt: h.verifiedAt?.toISOString() ?? null,
    timezone: h.timezone,
    currency: h.currency,
    defaultSlotMinutes: h.defaultSlotMinutes,
    taxRatePercent: h.taxRatePercent.toString(),
    invoicePrefix: h.invoicePrefix,
    subscriptionStatus: h.subscriptionStatus,
    timezoneLocked: h.taxTimezoneLockedAt !== null,
    createdAt: h.createdAt.toISOString(),
  };
}

/**
 * Hospital onboarding (SCOPE-005, ROLE-001/002). Super Admins create, verify and suspend
 * hospitals; a Hospital Admin can read and edit their own hospital's profile and billing settings.
 * Hospitals are a global table; who may see which hospital is decided by TenantGuard (@TenantParam).
 */
@Injectable()
export class HospitalsService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly auth: AuthService,
    private readonly sessions: SessionStore,
  ) {}

  async list(q: ListHospitalsQuery): Promise<PaginatedResult<HospitalDto>> {
    const where: Prisma.HospitalWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { code: { contains: q.search, mode: 'insensitive' } },
              { email: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.client.hospital.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...skipTake(q),
      }),
      this.db.client.hospital.count({ where }),
    ]);
    return PaginatedResult.of(rows.map(toHospital), total, q.page, q.limit);
  }

  async get(id: string): Promise<HospitalDto> {
    const h = await this.db.client.hospital.findUnique({ where: { id } });
    if (!h) throw notFound('hospital');
    return toHospital(h);
  }

  /** Creates the hospital (PENDING) and its first Hospital Admin, who receives a set-password link. */
  async create(dto: CreateHospitalDto): Promise<HospitalDto> {
    const db = this.db.client;
    if (await db.user.findUnique({ where: { email: dto.admin.email }, select: { id: true } })) {
      throw new ConflictException({
        code: 'EMAIL_IN_USE',
        message: 'The administrator email is already used by another account.',
      });
    }
    let created: { hospital: Hospital; adminId: string };
    try {
      created = await db.$transaction(async (tx) => {
        const hospital = await tx.hospital.create({
          data: {
            name: dto.name,
            code: dto.code,
            email: dto.email,
            phone: dto.phone,
            licenseNumber: dto.licenseNumber,
            ...(dto.timezone ? { timezone: dto.timezone } : {}),
            ...(dto.currency ? { currency: dto.currency } : {}),
          },
        });
        const admin = await tx.user.create({
          data: {
            hospitalId: hospital.id,
            email: dto.admin.email,
            phone: dto.admin.phone ?? null,
            // Unusable placeholder: the administrator sets their own password from the emailed link.
            passwordHash: '!',
            role: 'HOSPITAL_ADMIN',
            firstName: dto.admin.firstName,
            lastName: dto.admin.lastName,
          },
        });
        await tx.staffProfile.create({
          data: {
            hospitalId: hospital.id,
            userId: admin.id,
            designation: 'Hospital Administrator',
          },
        });
        return { hospital, adminId: admin.id };
      });
    } catch (e) {
      mapPrismaError(e, { conflict: 'A hospital with this code already exists.' });
    }
    await this.auth.sendWelcome(
      { id: created.adminId, email: dto.admin.email, firstName: dto.admin.firstName },
      created.hospital.name,
    );
    return toHospital(created.hospital);
  }

  async update(id: string, dto: UpdateHospitalDto): Promise<HospitalDto> {
    const current = await this.db.client.hospital.findUnique({ where: { id } });
    if (!current) throw notFound('hospital');
    // DEC-057: once tax dates exist the time zone is fixed; corrections need a reviewed migration.
    if (dto.timezone && dto.timezone !== current.timezone && current.taxTimezoneLockedAt)
      throw timezoneLocked();
    try {
      const h = await this.db.client.hospital.update({ where: { id }, data: { ...dto } });
      return toHospital(h);
    } catch (e) {
      // The lock can be stamped between the read above and this update; the database trigger refuses it.
      if (e instanceof Error && e.message.includes('time zone of a hospital with tax versions'))
        throw timezoneLocked();
      throw e;
    }
  }

  async setStatus(id: string, status: 'VERIFIED' | 'SUSPENDED'): Promise<HospitalDto> {
    const current = await this.db.client.hospital.findUnique({ where: { id } });
    if (!current) throw notFound('hospital');
    const h = await this.db.client.hospital.update({
      where: { id },
      data: {
        status,
        ...(status === 'VERIFIED' && !current.verifiedAt ? { verifiedAt: new Date() } : {}),
      },
    });
    if (status === 'SUSPENDED') {
      // Sign out every user of the hospital at once; new sign-ins are refused (HOSPITAL_SUSPENDED).
      const users = await this.db.client.user.findMany({
        where: { hospitalId: id },
        select: { id: true },
      });
      for (const u of users) await this.sessions.revokeAll(u.id);
    }
    return toHospital(h);
  }
}
