import type { PaginationMeta } from '@medcore/types';

/**
 * Return this from a controller to get the PRD paginated envelope:
 * { success: true, data: [...], meta: { page, limit, total, totalPages } }.
 */
export class PaginatedResult<T> {
  constructor(
    public readonly items: T[],
    public readonly meta: PaginationMeta,
  ) {}

  static of<T>(items: T[], total: number, page: number, limit: number): PaginatedResult<T> {
    return new PaginatedResult(items, {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    });
  }
}
