import { Controller, Get, Module, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { SEARCH_KINDS, type SearchKind } from '@medcore/types';
import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { AuditRead } from '../../common/audit/audit.decorators';
import { CurrentUser, Roles, type AuthPrincipal } from '../../common/auth/decorators';
import { AnalyticsService } from './analytics.service';
import { SEARCH_ACCESS, SearchService } from './search.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

class RangeQuery {
  @ApiProperty({ example: '2026-11-01' })
  @Matches(DAY, { message: 'from must be a date (YYYY-MM-DD)' })
  from!: string;

  @ApiProperty({ example: '2026-11-22' })
  @Matches(DAY, { message: 'to must be a date (YYYY-MM-DD)' })
  to!: string;
}

class SearchQuery {
  @ApiProperty({ minLength: 2, maxLength: 80 })
  @IsString()
  @Length(2, 80)
  q!: string;

  @ApiPropertyOptional({ enum: SEARCH_KINDS, isArray: true, description: 'Comma-separated kinds' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsArray()
  @IsIn(SEARCH_KINDS, { each: true })
  kinds?: SearchKind[];
}

const SEARCHERS = [...new Set(Object.values(SEARCH_ACCESS).flat())];

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller()
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly searcher: SearchService,
  ) {}

  @Get('analytics/overview')
  @Roles('HOSPITAL_ADMIN')
  @AuditRead('analytics.overview', 'Hospital')
  @ApiOperation({
    summary: 'Hospital overview: patients, appointments, departments, doctors, beds',
  })
  overview(@CurrentUser() a: AuthPrincipal, @Query() q: RangeQuery) {
    return this.analytics.overview(a, q.from, q.to);
  }

  @Get('analytics/operations')
  @Roles('HOSPITAL_ADMIN')
  @AuditRead('analytics.operations', 'Hospital')
  @ApiOperation({
    summary: 'Operations: cancellations, lab workload and turnaround, pharmacy, billing',
  })
  operations(@CurrentUser() a: AuthPrincipal, @Query() q: RangeQuery) {
    return this.analytics.operations(a, q.from, q.to);
  }

  @Get('search')
  @Roles(...SEARCHERS)
  @AuditRead('search.query', 'Search')
  @ApiOperation({ summary: 'Global search within the hospital, limited to what the role may open' })
  search(@CurrentUser() a: AuthPrincipal, @Query() q: SearchQuery) {
    return this.searcher.search(a, q.q, q.kinds);
  }
}

/** Dashboards, analytics and global search (Phase 11). */
@Module({ controllers: [AnalyticsController], providers: [AnalyticsService, SearchService] })
export class AnalyticsModule {}
