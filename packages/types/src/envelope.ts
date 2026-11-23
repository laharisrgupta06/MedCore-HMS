/**
 * Standard API response envelopes, exactly as specified in PRD section 08
 * ("Standard Response Envelope").
 */

/** Success: { "success": true, "data": { ... }, "message": "OK" } */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  message: string;
}

/** Pagination metadata: { "page": 1, "limit": 20, "total": 348, "totalPages": 18 } */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Paginated list: { "success": true, "data": [...], "meta": { ... } } */
export interface ApiPaginated<T> {
  success: true;
  data: T[];
  meta: PaginationMeta;
}

/** Error: { "success": false, "error": { "code": "SLOT_UNAVAILABLE", "message": "..." } } */
export interface ApiErrorBody {
  code: string;
  message: string;
  /** Optional structured detail, e.g. field-level validation errors. */
  details?: unknown;
}

export interface ApiError {
  success: false;
  error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
export type ApiListResponse<T> = ApiPaginated<T> | ApiError;

/** Field-level validation error carried in ApiErrorBody.details for VALIDATION_ERROR. */
export interface FieldError {
  field: string;
  messages: string[];
}

/** Error codes shared by every module. Module-specific codes are added per phase. */
export const CommonErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type CommonErrorCode = (typeof CommonErrorCode)[keyof typeof CommonErrorCode];
