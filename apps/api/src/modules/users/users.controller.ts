import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { UserSummary } from '@medcore/types';
import { CurrentUser, Roles, type AuthPrincipal } from '../../common/auth/decorators';
import { Audit } from '../../common/audit/audit.decorators';
import type { PaginatedResult } from '../../common/http/paginated-result';
import { ListUsersQuery, UpdateUserDto } from './dto/users.dto';
import { UsersService } from './users.service';

const uuid = new ParseUUIDPipe({ version: '4' });

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN')
  @ApiOperation({
    summary: 'List users (Hospital Admin: own hospital; Super Admin: all, optional hospitalId)',
  })
  list(
    @CurrentUser() actor: AuthPrincipal,
    @Query() q: ListUsersQuery,
  ): Promise<PaginatedResult<UserSummary>> {
    return this.users.list(actor, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user: self or administrator (API-012)' })
  @ApiResponse({ status: 404, description: 'Unknown user or user of another hospital' })
  get(@CurrentUser() actor: AuthPrincipal, @Param('id', uuid) id: string): Promise<UserSummary> {
    return this.users.get(actor, id);
  }

  @Patch(':id')
  @Audit('user.update', 'User')
  @ApiOperation({
    summary: 'Update name or phone (self or administrator); isActive (administrator only)',
  })
  update(
    @CurrentUser() actor: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserSummary> {
    return this.users.update(actor, id, dto);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN')
  @Audit('user.delete', 'User')
  @ApiOperation({ summary: 'Close an account (soft delete) and sign it out everywhere' })
  remove(
    @CurrentUser() actor: AuthPrincipal,
    @Param('id', uuid) id: string,
  ): Promise<{ id: string; deleted: true }> {
    return this.users.remove(actor, id);
  }
}
