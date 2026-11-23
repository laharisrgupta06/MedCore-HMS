import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ALL_ROLES } from '@medcore/types';
import { CurrentUser, Roles, type AuthPrincipal } from '../../common/auth/decorators';
import { NotificationsService } from './notifications.service';

const uuid = new ParseUUIDPipe({ version: '4' });

class ListQuery {
  @ApiPropertyOptional({ description: 'Only unread notifications' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unread?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/**
 * The caller's own notifications (NOTIF-001). Every role has an inbox; the service filters every
 * query by recipient, so nobody can read or change another user's notifications.
 */
@ApiTags('Notifications')
@Roles(...ALL_ROLES)
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'My notifications, newest first' })
  list(@CurrentUser() a: AuthPrincipal, @Query() q: ListQuery) {
    return this.notifications.list(a, {
      unread: q.unread,
      page: q.page ?? 1,
      limit: q.limit ?? 20,
    });
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'How many of my notifications are unread' })
  unread(@CurrentUser() a: AuthPrincipal) {
    return this.notifications.unreadCount(a);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one of my notifications as read' })
  read(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.notifications.markRead(a, id);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all my notifications as read' })
  readAll(@CurrentUser() a: AuthPrincipal) {
    return this.notifications.markAllRead(a);
  }
}
