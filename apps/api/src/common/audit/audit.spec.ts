import { Body, Controller, Post } from '@nestjs/common';
import { AUTH_COOKIES, CSRF_HEADER } from '@medcore/types';
import { Allow } from 'class-validator';
import request from 'supertest';
import { createAuthTestApp } from '../../testing/auth-test-app';
import { Audit } from './audit.decorators';
import { bodyMetadata, safeChanges } from './audit-metadata';

class ProbeBody {
  @Allow() password?: string;
  @Allow() otp?: string;
  @Allow() refreshToken?: string;
  @Allow() diagnosis?: string;
  @Allow() notes?: string;
  @Allow() status?: string;
  @Allow() isActive?: boolean;
}

@Controller('probe-audit')
class ProbeAuditController {
  @Post('declared')
  @Audit('probe.write', 'Probe', ['status', 'isActive', 'password'])
  declared(@Body() _b: ProbeBody) {
    return { id: 'p1' };
  }

  @Post('generic')
  generic(@Body() _b: ProbeBody) {
    return { id: 'p2' };
  }
}

const SECRETS = {
  password: 'Hunter2-password',
  otp: '493817',
  refreshToken: 'eyJhbGciOiJIUzI1NiJ9.secret.sig',
  diagnosis: 'Malignant neoplasm of breast',
  notes: 'Patient disclosed sensitive history',
};

describe('Audit metadata never stores secrets or clinical values (SEC-012, DEC-030)', () => {
  it('records field names only, plus scalar values of declared safe fields (still redacted)', () => {
    expect(
      bodyMetadata({ ...SECRETS, status: 'ACTIVE', isActive: false }, [
        'status',
        'isActive',
        'password',
      ]),
    ).toEqual({
      fields: ['diagnosis', 'isActive', 'notes', 'otp', 'password', 'refreshToken', 'status'],
      values: { status: 'ACTIVE', isActive: false, password: '[REDACTED]' },
    });
    expect(bodyMetadata({ status: { nested: 'x' } }, ['status'])).toEqual({ fields: ['status'] });
    expect(bodyMetadata(undefined)).toBeUndefined();
    expect(bodyMetadata({})).toBeUndefined();
  });

  it('safeChanges drops raw bodies, redacts sensitive keys, bounds size and depth', () => {
    const out = safeChanges({
      body: SECRETS,
      token: 'abc',
      nested: { otp: '123456', deeper: { deepest: { x: 1 } } },
      long: 'x'.repeat(500),
      sessionId: 's-1',
    });
    expect(out.body).toBeUndefined();
    expect(out.token).toBe('[REDACTED]');
    expect((out.nested as Record<string, unknown>).otp).toBe('[REDACTED]');
    expect(
      ((out.nested as Record<string, unknown>).deeper as Record<string, unknown>).deepest,
    ).toBe('[Omitted]');
    expect((out.long as string).length).toBeLessThanOrEqual(201);
    expect(out.sessionId).toBe('s-1');
  });

  it('end to end: nothing sensitive reaches audit_logs through a write route', async () => {
    const t = await createAuthTestApp({}, { controllers: [ProbeAuditController] });
    try {
      const h = t.prisma.addHospital();
      const nurse = t.prisma.addUser({ role: 'NURSE', hospitalId: h.id });
      const token = await t.tokenFor(nurse);
      const csrf = 'k'.repeat(43);
      for (const path of ['declared', 'generic']) {
        await request(t.app.getHttpServer())
          .post(`/api/probe-audit/${path}`)
          .set('Authorization', `Bearer ${token}`)
          .set('Cookie', `${AUTH_COOKIES.csrf}=${csrf}`)
          .set(CSRF_HEADER, csrf)
          .send({ ...SECRETS, status: 'ACTIVE' })
          .expect(201);
      }
      const stored = JSON.stringify(t.prisma.audit);
      for (const value of Object.values(SECRETS)) expect(stored).not.toContain(value);
      expect(stored).not.toContain(token);
      const declared = t.prisma.audit.find((a) => a.action === 'probe.write');
      expect(declared?.changes).toMatchObject({ values: { status: 'ACTIVE' } });
      const generic = t.prisma.audit.find((a) => a.action === 'http.post');
      expect(generic?.changes).toEqual({
        method: 'POST',
        route: '/api/probe-audit/generic',
        fields: ['diagnosis', 'notes', 'otp', 'password', 'refreshToken', 'status'],
      });
    } finally {
      await t.app.close();
    }
  });
});
