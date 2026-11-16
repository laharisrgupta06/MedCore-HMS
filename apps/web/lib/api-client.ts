import type { ApiErrorBody, ApiResponse } from '@medcore/types';

/** Error raised for every failed API call, carrying the PRD error envelope fields. */
export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export const API_BASE = '/api';

/**
 * Calls the API through the same-origin Next.js proxy and unwraps the PRD envelope.
 * Resolves with `data` only when the backend confirms `success: true`.
 */
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiClientError(
      'NETWORK_ERROR',
      'Could not reach the server. Check your connection and try again.',
      0,
    );
  }

  let body: ApiResponse<T>;
  try {
    body = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new ApiClientError(
      'INVALID_RESPONSE',
      'The server returned an unexpected response.',
      res.status,
    );
  }

  if (!res.ok || body.success !== true) {
    const err: ApiErrorBody | undefined = body.success === false ? body.error : undefined;
    throw new ApiClientError(
      err?.code ?? 'UNKNOWN_ERROR',
      err?.message ?? 'The request failed.',
      res.status,
      err?.details,
    );
  }
  return body.data;
}
