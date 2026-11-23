import type { FieldError } from '@medcore/types';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiClientError } from './api-client';

/** Messages for error codes the API returns; anything else shows the server's own message. */
const FRIENDLY: Record<string, string> = {
  NETWORK_ERROR: 'Could not reach the server. Check your connection and try again.',
  RATE_LIMITED: 'Too many attempts. Please wait a few minutes and try again.',
  INTERNAL_ERROR: 'Something went wrong on our side. Please try again.',
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiClientError) return FRIENDLY[e.code] ?? e.message;
  if (e instanceof Error && e.message) return e.message;
  return 'Something went wrong. Please try again.';
}

/**
 * Applies the API's VALIDATION_ERROR field details to the form. Returns true when at least one
 * field error was shown, so the caller does not repeat it in a banner.
 */
export function applyServerFieldErrors<T extends FieldValues>(
  e: unknown,
  setError: UseFormSetError<T>,
  fields: readonly string[],
): boolean {
  if (!(e instanceof ApiClientError) || e.code !== 'VALIDATION_ERROR' || !Array.isArray(e.details))
    return false;
  let shown = false;
  for (const d of e.details as FieldError[]) {
    if (fields.includes(d.field)) {
      setError(d.field as Path<T>, { type: 'server', message: d.messages[0] });
      shown = true;
    }
  }
  return shown;
}
