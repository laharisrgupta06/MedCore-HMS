import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiList, apiRequest, registerAuthHandlers } from './api-client';

const ok = (data: unknown, meta?: unknown) =>
  new Response(JSON.stringify({ success: true, data, ...(meta ? { meta } : {}), message: 'OK' }), {
    status: 200,
  });
const fail = (status: number, code: string) =>
  new Response(JSON.stringify({ success: false, error: { code, message: code } }), { status });

describe('apiRequest: CSRF and session handling', () => {
  beforeEach(() => {
    document.cookie = 'mc_csrf=' + 'c'.repeat(43) + '; path=/';
  });
  afterEach(() => {
    vi.restoreAllMocks();
    registerAuthHandlers(null);
    document.cookie = 'mc_csrf=; Max-Age=0; path=/';
  });

  it('sends the CSRF cookie value in the header on writes, never on reads', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(ok({})));
    await apiRequest('/x', { method: 'POST', json: { a: 1 } });
    await apiRequest('/y');
    const [, post] = spy.mock.calls[0]!;
    const [, get] = spy.mock.calls[1]!;
    expect((post!.headers as Record<string, string>)['x-csrf-token']).toBe('c'.repeat(43));
    expect(post!.body).toBe('{"a":1}');
    expect((get!.headers as Record<string, string>)['x-csrf-token']).toBeUndefined();
  });

  it('fetches a CSRF token first when the cookie is missing', async () => {
    document.cookie = 'mc_csrf=; Max-Age=0; path=/';
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(ok({ csrfToken: 't'.repeat(43) }))
      .mockResolvedValueOnce(ok({ done: true }));
    await apiRequest('/x', { method: 'POST' });
    expect(spy.mock.calls[0]![0]).toBe('/api/auth/csrf');
    expect((spy.mock.calls[1]![1]!.headers as Record<string, string>)['x-csrf-token']).toBe(
      't'.repeat(43),
    );
  });

  it('attaches the access token, refreshes once on 401 and retries', async () => {
    let token = 'old';
    const refresh = vi.fn(async () => {
      token = 'new';
      return true;
    });
    registerAuthHandlers({ getAccessToken: () => token, refresh, onSessionExpired: vi.fn() });
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(fail(401, 'UNAUTHENTICATED'))
      .mockResolvedValueOnce(ok({ me: 1 }));
    await expect(apiRequest('/auth/me')).resolves.toEqual({ me: 1 });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0]![1]!.headers as Record<string, string>).Authorization).toBe(
      'Bearer old',
    );
    expect((spy.mock.calls[1]![1]!.headers as Record<string, string>).Authorization).toBe(
      'Bearer new',
    );
  });

  it('reports an expired session when the refresh fails, and does not loop', async () => {
    const onSessionExpired = vi.fn();
    registerAuthHandlers({
      getAccessToken: () => 'x',
      refresh: async () => false,
      onSessionExpired,
    });
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(fail(401, 'UNAUTHENTICATED'));
    await expect(apiRequest('/auth/me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not send the access token when auth is disabled', async () => {
    registerAuthHandlers({
      getAccessToken: () => 'secret',
      refresh: vi.fn(),
      onSessionExpired: vi.fn(),
    });
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({}));
    await apiRequest('/auth/login', { method: 'POST', json: {}, auth: false });
    expect(
      (spy.mock.calls[0]![1]!.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
  });

  it('apiList returns items and pagination meta', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      ok([{ id: 1 }], { page: 2, limit: 1, total: 3, totalPages: 3 }),
    );
    await expect(apiList('/users?page=2')).resolves.toEqual({
      items: [{ id: 1 }],
      meta: { page: 2, limit: 1, total: 3, totalPages: 3 },
    });
  });
});
