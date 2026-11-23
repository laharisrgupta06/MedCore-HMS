/** Query parameters accepted by every list endpoint (roadmap section 7). */
export interface PaginationQuery {
  page?: number;
  /** Maximum 100. */
  limit?: number;
  sort?: string;
  q?: string;
}

export const PAGINATION_DEFAULT_LIMIT = 20;
export const PAGINATION_MAX_LIMIT = 100;
