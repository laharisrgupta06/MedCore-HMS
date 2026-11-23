import { Injectable } from '@nestjs/common';
import type { NotificationView, UnreadCountView } from '@medcore/types';
import type { Notification } from '@prisma/client';
import type { AuthPrincipal } from '../../common/auth/decorators';
import { PaginatedResult } from '../../common/http/paginated-result';
import { notFound } from '../../common/http/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

const view = (n: Notification): NotificationView => ({
  id: n.id,
  type: n.type,
  title: n.title,
  body: n.body,
  entityType: n.entityType,
  entityId: n.entityId,
  readAt: n.readAt?.toISOString() ?? null,
  createdAt: n.createdAt.toISOString(),
});

/**
 * The signed-in user's own inbox. Every query is filtered by recipientId = the caller, so a user can
 * never read or change another user's notifications, whatever their role or hospital. Platform users
 * (super admin, hospitalId null) have an inbox too, which is why this does not use the tenant client.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: AuthPrincipal, q: { unread?: boolean; page: number; limit: number }) {
    const where = { recipientId: actor.userId, ...(q.unread ? { readAt: null } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return PaginatedResult.of(rows.map(view), total, q.page, q.limit);
  }

  async unreadCount(actor: AuthPrincipal): Promise<UnreadCountView> {
    return {
      unread: await this.prisma.notification.count({
        where: { recipientId: actor.userId, readAt: null },
      }),
    };
  }

  async markRead(actor: AuthPrincipal, id: string): Promise<NotificationView> {
    const r = await this.prisma.notification.updateMany({
      where: { id, recipientId: actor.userId, readAt: null },
      data: { readAt: new Date() },
    });
    const n = await this.prisma.notification.findFirst({
      where: { id, recipientId: actor.userId },
    });
    if (!n) throw notFound('notification');
    void r;
    return view(n);
  }

  async markAllRead(actor: AuthPrincipal): Promise<{ marked: number }> {
    const r = await this.prisma.notification.updateMany({
      where: { recipientId: actor.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { marked: r.count };
  }
}
