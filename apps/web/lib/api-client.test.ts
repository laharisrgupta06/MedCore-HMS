import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, apiRequest } from './api-client';

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('apiRequest', () => {
  afterEach(() => vi.restoreAllMocks());

  it('calls the same-origin /api proxy and unwraps data', async () => {
    const spy = respond(200, { success: true, data: { ok: 1 }, message: 'OK' });
    await expect(apiRequest('/health')).resolves.toEqual({ ok: 1 });
    expect(spy).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('throws the backend error code and message', async () => {
    respond(409, {
      success: false,
      error: { code: 'SLOT_UNAVAILABLE', message: 'This slot was just booked by another patient.' },
    });
    await expect(apiRequest('/appointments')).rejects.toMatchObject({
      code: 'SLOT_UNAVAILABLE',
      status: 409,
      message: 'This slot was just booked by another patient.',
    });
  });

  it('never resolves when the backend did not confirm success', async () => {
    respond(200, { success: false, error: { code: 'X', message: 'no' } });
    await expect(apiRequest('/x')).rejects.toBeInstanceOf(ApiClientError);
  });

  it('reports network failures and non-JSON responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(apiRequest('/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>', { status: 502 }));
    await expect(apiRequest('/x')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 502 });
  });
});
