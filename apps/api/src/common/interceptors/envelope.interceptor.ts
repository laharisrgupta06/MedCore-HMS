import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { ApiPaginated, ApiSuccess } from '@medcore/types';
import { Observable, map } from 'rxjs';
import { PaginatedResult } from '../http/paginated-result';

/** Wraps every successful controller result in the PRD response envelope. */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(
    _ctx: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiSuccess<unknown> | ApiPaginated<unknown>> {
    return next.handle().pipe(map((result: unknown) => wrap(result)));
  }
}

export function wrap(result: unknown): ApiSuccess<unknown> | ApiPaginated<unknown> {
  if (result instanceof PaginatedResult) {
    return { success: true, data: result.items, meta: result.meta };
  }
  return { success: true, data: result ?? null, message: 'OK' };
}
