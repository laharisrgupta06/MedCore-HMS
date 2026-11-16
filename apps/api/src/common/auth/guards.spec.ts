import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CsrfGuard } from './csrf.guard';
import { RolesGuard } from './roles.guard';

function ctx(req: Record<string, unknown>, meta: Record<string, unknown> = {}) {
  const handler = () => undefined;
  const reflector = {
    getAllAndOverride: (key: string) => meta[key],
  } as unknown as Reflector;
  const context = {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => Object,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { reflector, context };
}

describe('CsrfGuard', () => {
  const token = 'x'.repeat(43);
  it('allows safe methods and matching double-submit tokens', () => {
    const a = ctx({ method: 'GET', headers: {}, cookies: {} });
    expect(new CsrfGuard(a.reflector).canActivate(a.context)).toBe(true);
    const b = ctx({
      method: 'POST',
      headers: { 'x-csrf-token': token },
      cookies: { mc_csrf: token },
    });
    expect(new CsrfGuard(b.reflector).canActivate(b.context)).toBe(true);
  });
  it('rejects missing, short or mismatched tokens', () => {
    for (const req of [
      { method: 'POST', headers: {}, cookies: { mc_csrf: token } },
      { method: 'DELETE', headers: { 'x-csrf-token': 'abc' }, cookies: { mc_csrf: 'abc' } },
      { method: 'PATCH', headers: { 'x-csrf-token': 'y'.repeat(43) }, cookies: { mc_csrf: token } },
    ]) {
      const c = ctx(req);
      expect(() => new CsrfGuard(c.reflector).canActivate(c.context)).toThrow(ForbiddenException);
    }
  });
  it('honours @SkipCsrf()', () => {
    const c = ctx({ method: 'POST', headers: {}, cookies: {} }, { 'medcore:skipCsrf': true });
    expect(new CsrfGuard(c.reflector).canActivate(c.context)).toBe(true);
  });
});

describe('RolesGuard', () => {
  it('allows listed roles, routes without @Roles() and public routes; refuses others', () => {
    const doctor = { user: { role: 'DOCTOR' } };
    const allow = ctx(doctor, { 'medcore:roles': ['DOCTOR', 'NURSE'] });
    expect(new RolesGuard(allow.reflector).canActivate(allow.context)).toBe(true);
    const open = ctx(doctor);
    expect(new RolesGuard(open.reflector).canActivate(open.context)).toBe(true);
    const pub = ctx({}, { 'medcore:isPublic': true, 'medcore:roles': ['SUPER_ADMIN'] });
    expect(new RolesGuard(pub.reflector).canActivate(pub.context)).toBe(true);
    const deny = ctx(doctor, { 'medcore:roles': ['SUPER_ADMIN'] });
    expect(() => new RolesGuard(deny.reflector).canActivate(deny.context)).toThrow(
      ForbiddenException,
    );
    const anon = ctx({}, { 'medcore:roles': ['DOCTOR'] });
    expect(() => new RolesGuard(anon.reflector).canActivate(anon.context)).toThrow(
      ForbiddenException,
    );
  });
});
