import { wrap } from '../interceptors/envelope.interceptor';
import { PaginatedResult } from './paginated-result';

describe('response envelope', () => {
  it('matches the PRD paginated example (348 items, limit 20 -> 18 pages)', () => {
    expect(wrap(PaginatedResult.of([{ id: 1 }], 348, 1, 20))).toEqual({
      success: true,
      data: [{ id: 1 }],
      meta: { page: 1, limit: 20, total: 348, totalPages: 18 },
    });
  });

  it('reports zero pages for an empty list', () => {
    expect(PaginatedResult.of([], 0, 1, 20).meta.totalPages).toBe(0);
  });

  it('wraps plain results with message OK and turns undefined into null', () => {
    expect(wrap({ a: 1 })).toEqual({ success: true, data: { a: 1 }, message: 'OK' });
    expect(wrap(undefined)).toEqual({ success: true, data: null, message: 'OK' });
  });
});
