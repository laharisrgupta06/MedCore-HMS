import { REDACTED, sanitize } from './sanitize';

describe('sanitize', () => {
  it('redacts sensitive keys at any depth', () => {
    const out = sanitize({
      email: 'a@b.com',
      password: 'p@ss',
      nested: { refreshToken: 'rt', otp: '123456', profile: { apiKey: 'k', name: 'Asha' } },
      list: [{ secret: 's' }],
    });
    expect(out).toEqual({
      email: 'a@b.com',
      password: REDACTED,
      nested: {
        refreshToken: REDACTED,
        otp: REDACTED,
        profile: { apiKey: REDACTED, name: 'Asha' },
      },
      list: [{ secret: REDACTED }],
    });
  });

  it('redacts bearer tokens inside strings', () => {
    expect(sanitize('Authorization failed for Bearer eyJhbGciOi.abc.def')).toBe(
      `Authorization failed for Bearer ${REDACTED}`,
    );
  });

  it('handles circular references and primitives', () => {
    const a: Record<string, unknown> = { name: 'x' };
    a.self = a;
    expect(sanitize(a)).toEqual({ name: 'x', self: '[Circular]' });
    expect(sanitize(42)).toBe(42);
    expect(sanitize(null)).toBeNull();
  });
});
