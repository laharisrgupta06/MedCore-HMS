import {
  AUTH_COOKIES,
  CSRF_HEADER,
  type ApiErrorBody,
  type CsrfResponse,
  type PaginationMeta,
} from '@medcore/types';

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
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Session hooks registered by the auth store. The access token lives only in memory; the refresh
 * token is an httpOnly cookie the browser sends to /api/auth automatically.
 */
interface AuthHandlers {
  getAccessToken: () => string | null;
  /** Obtains a new access token via the refresh cookie; resolves false when the session ended. */
  refresh: () => Promise<boolean>;
  onSessionExpired: () => void;
}
let handlers: AuthHandlers | null = null;
export function registerAuthHandlers(h: AuthHandlers | null): void {
  handlers = h;
}

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const hit = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

let csrfPromise: Promise<string> | null = null;
/** Double-submit CSRF token (SEC-010): the mc_csrf cookie value, fetched once if missing. */
export async function ensureCsrfToken(): Promise<string> {
  const existing = readCookie(AUTH_COOKIES.csrf);
  if (existing) return existing;
  csrfPromise ??= rawRequest<CsrfResponse>('/auth/csrf', { method: 'GET' })
    .then((r) => r.data.csrfToken)
    .finally(() => {
      csrfPromise = null;
    });
  return csrfPromise;
}

interface Envelope<T> {
  data: T;
  meta?: PaginationMeta;
}

async function rawRequest<T>(path: string, init: RequestInit): Promise<Envelope<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        // JSON bodies only; FormData lets the browser set the multipart boundary.
        ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
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

  let body: { success?: boolean; data?: T; meta?: PaginationMeta; error?: ApiErrorBody };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new ApiClientError(
      'INVALID_RESPONSE',
      'The server returned an unexpected response.',
      res.status,
    );
  }

  if (!res.ok || body.success !== true) {
    const err = body.success === false ? body.error : undefined;
    throw new ApiClientError(
      err?.code ?? 'UNKNOWN_ERROR',
      err?.message ?? 'The request failed.',
      res.status,
      err?.details,
    );
  }
  return { data: body.data as T, meta: body.meta };
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** JSON body; serialised automatically. */
  json?: unknown;
  /** Multipart body (file uploads). */
  form?: FormData;
  /** Attach the access token and refresh it once on expiry. Default true. */
  auth?: boolean;
}

async function send<T>(
  path: string,
  opts: RequestOptions = {},
  retried = false,
): Promise<Envelope<T>> {
  const { json, form, auth = true, ...init } = opts;
  const method = (init.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (!SAFE.has(method)) headers[CSRF_HEADER] = await ensureCsrfToken();
  const token = auth ? handlers?.getAccessToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    return await rawRequest<T>(path, {
      ...init,
      method,
      headers,
      body: form ?? (json === undefined ? undefined : JSON.stringify(json)),
    });
  } catch (e) {
    if (
      auth &&
      !retried &&
      handlers &&
      e instanceof ApiClientError &&
      e.status === 401 &&
      e.code === 'UNAUTHENTICATED'
    ) {
      if (await handlers.refresh()) return send<T>(path, opts, true);
      handlers.onSessionExpired();
    }
    if (e instanceof ApiClientError && e.code === 'CSRF_TOKEN_INVALID' && !retried) {
      // The CSRF cookie rotated or expired: fetch a fresh one and retry once.
      document.cookie = `${AUTH_COOKIES.csrf}=; Max-Age=0; path=/`;
      return send<T>(path, opts, true);
    }
    throw e;
  }
}

/**
 * Calls the API through the same-origin Next.js proxy and unwraps the PRD envelope.
 * Resolves with `data` only when the backend confirms `success: true`.
 */
export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return (await send<T>(path, opts)).data;
}

export interface Page<T> {
  items: T[];
  meta: PaginationMeta;
}

/** Paginated list endpoints: `{ success, data: [...], meta }`. */
export async function apiList<T>(path: string, opts: RequestOptions = {}): Promise<Page<T>> {
  const r = await send<T[]>(path, opts);
  return {
    items: r.data,
    meta: r.meta ?? { page: 1, limit: r.data.length, total: r.data.length, totalPages: 1 },
  };
}

/** Builds a query string from defined, non-empty values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Downloads a binary response (file attachments) with the access token; errors use the API envelope. */
export async function apiBlob(path: string, retried = false): Promise<Blob> {
  const token = handlers?.getAccessToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      credentials: 'same-origin',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    throw new ApiClientError(
      'NETWORK_ERROR',
      'Could not reach the server. Check your connection and try again.',
      0,
    );
  }
  if (res.ok) return res.blob();
  const body = (await res.json().catch(() => ({}))) as { error?: ApiErrorBody };
  if (res.status === 401 && !retried && handlers && (await handlers.refresh()))
    return apiBlob(path, true);
  throw new ApiClientError(
    body.error?.code ?? 'UNKNOWN_ERROR',
    body.error?.message ?? 'The download failed.',
    res.status,
  );
}
