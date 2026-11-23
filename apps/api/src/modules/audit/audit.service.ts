import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { safeChanges } from '../../common/audit/audit-metadata';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface AuditEvent {
  action: string;
  entityType: string;
  entityId?: string | null;
  actorId?: string | null;
  hospitalId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  changes?: Record<string, unknown>;
}

/**
 * Writes append-only audit entries (SEC-012, DB-013). Every entry passes safeChanges(): sensitive
 * keys redacted, no raw bodies, bounded size.
 * A failed audit write is logged as an error but does not undo the action that already happened.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(e: AuditEvent): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: e.action,
          entityType: e.entityType,
          entityId: e.entityId ?? null,
          actorId: e.actorId ?? null,
          hospitalId: e.hospitalId ?? null,
          ipAddress: e.ipAddress ?? null,
          userAgent: e.userAgent?.slice(0, 512) ?? null,
          changes: e.changes ? (safeChanges(e.changes) as Prisma.InputJsonValue) : undefined,
        },
      });
    } catch (err) {
      this.logger.error(`Audit write failed for ${e.action}: ${(err as Error).message}`);
    }
  }
}
