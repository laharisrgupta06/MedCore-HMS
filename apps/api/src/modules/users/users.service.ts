import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CommonErrorCode, type Role, type UserSummary } from '@medcore/types';
import type { Prisma, User } from '@prisma/client';
import type { AuthPrincipal } from '../../common/auth/decorators';
import { SessionStore } from '../../common/auth/session.store';
import { PaginatedResult } from '../../common/http/paginated-result';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import type { ListUsersQuery, UpdateUserDto } from './dto/users.dto';

const ADMINS: ReadonlySet<Role> = new Set<Role>(['SUPER_ADMIN', 'HOSPITAL_ADMIN']);

export function toSummary(u: User): UserSummary {
  return {
    id: u.id,
    email: u.email,
    phone: u.phone,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role as Role,
    hospitalId: u.hospitalId,
    isActive: u.isActive,
    emailVerified: u.emailVerifiedAt !== null,
    phoneVerified: u.phoneVerifiedAt !== null,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

function notFound(): NotFoundException {
  return new NotFoundException({ code: CommonErrorCode.NOT_FOUND, message: 'User not found.' });
}

function forbidden(message: string): ForbiddenException {
  return new ForbiddenException({ code: CommonErrorCode.FORBIDDEN, message });
}

/**
 * Users endpoints (API-012). Tenant isolation comes from TenantPrismaService: another hospital's
 * user is never found (404). Inside a hospital, "Self or Admin" is enforced here.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly sessions: SessionStore,
  ) {}

  private async load(id: string): Promise<User> {
    const user = await this.db.client.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw notFound();
    return user;
  }

  private assertSelfOrAdmin(actor: AuthPrincipal, target: User): void {
    if (actor.userId !== target.id && !ADMINS.has(actor.role)) {
      throw forbidden('You can only view or change your own account.');
    }
    // A Hospital Admin never manages platform accounts (they have no hospital, so they are
    // already invisible to the scoped client; this is a second line of defence).
    if (actor.role === 'HOSPITAL_ADMIN' && target.role === 'SUPER_ADMIN') throw notFound();
  }

  async list(actor: AuthPrincipal, q: ListUsersQuery): Promise<PaginatedResult<UserSummary>> {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(q.role ? { role: q.role } : {}),
      ...(q.isActive !== undefined ? { isActive: q.isActive } : {}),
      ...(q.hospitalId && actor.role === 'SUPER_ADMIN' ? { hospitalId: q.hospitalId } : {}),
      ...(q.search
        ? {
            OR: [
              { firstName: { contains: q.search, mode: 'insensitive' } },
              { lastName: { contains: q.search, mode: 'insensitive' } },
              { email: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.client.user.findMany({
        where,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.db.client.user.count({ where }),
    ]);
    return PaginatedResult.of(rows.map(toSummary), total, q.page, q.limit);
  }

  async get(actor: AuthPrincipal, id: string): Promise<UserSummary> {
    const user = await this.load(id);
    this.assertSelfOrAdmin(actor, user);
    return toSummary(user);
  }

  async update(actor: AuthPrincipal, id: string, dto: UpdateUserDto): Promise<UserSummary> {
    const user = await this.load(id);
    this.assertSelfOrAdmin(actor, user);
    const isAdmin = ADMINS.has(actor.role);
    if (dto.isActive !== undefined) {
      if (!isAdmin) throw forbidden('Only an administrator can activate or deactivate accounts.');
      if (actor.userId === id) throw forbidden('You cannot deactivate your own account.');
    }
    const data: Prisma.UserUpdateInput = {
      ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
      ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    };
    if (dto.phone !== undefined && dto.phone !== user.phone) {
      data.phone = dto.phone;
      data.phoneVerifiedAt = null; // a new number must be verified again (AUTH-007)
    }
    const updated = await this.db.client.user.update({ where: { id }, data });
    if (dto.isActive === false) await this.sessions.revokeAll(id);
    return toSummary(updated);
  }

  /** Soft delete: the account is closed and signed out; clinical and financial history stays. */
  async remove(actor: AuthPrincipal, id: string): Promise<{ id: string; deleted: true }> {
    if (!ADMINS.has(actor.role)) throw forbidden('Only an administrator can delete accounts.');
    const user = await this.load(id);
    this.assertSelfOrAdmin(actor, user);
    if (actor.userId === id) throw forbidden('You cannot delete your own account.');
    await this.db.client.user.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.sessions.revokeAll(id);
    return { id, deleted: true };
  }
}
