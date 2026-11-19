import { ForbiddenException } from '@nestjs/common';
import { scopeArgs, TENANT_MODELS } from './tenant-scope';

const H = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('tenant scoping of Prisma operations (TEN-002/003)', () => {
  it('knows the 51 hospital-scoped models and leaves the 4 global ones alone', () => {
    expect(TENANT_MODELS.size).toBe(51);
    // M-08: the nightly expiry results are hospital-scoped like every other hospital table.
    expect(TENANT_MODELS.has('ExpiryReport')).toBe(true);
    expect(TENANT_MODELS.has('PrescriptionEvent')).toBe(true);
    // M-11a: tax configuration is hospital data; the statutory room rule is platform reference data.
    for (const scoped of [
      'TaxClassification',
      'TaxClassificationVersion',
      'HospitalTaxDefault',
      'HospitalGstRegistration',
    ]) {
      expect(TENANT_MODELS.has(scoped)).toBe(true);
    }
    // M-11b: number series, invoice history, correction requests and notes are hospital data.
    for (const scoped of [
      'DocumentNumberSeries',
      'InvoiceEvent',
      'InvoiceCorrectionRequest',
      'InvoiceCorrectionRequestNote',
    ]) {
      expect(TENANT_MODELS.has(scoped)).toBe(true);
    }
    for (const global of ['Hospital', 'Icd10Code', 'WebhookEvent', 'StatutoryRoomTaxRule']) {
      expect(TENANT_MODELS.has(global)).toBe(false);
      expect(scopeArgs(global, 'findMany', { where: { id: 'x' } }, H)).toEqual({
        where: { id: 'x' },
      });
    }
  });

  it.each([
    'findUnique',
    'findFirst',
    'findMany',
    'count',
    'update',
    'updateMany',
    'delete',
    'deleteMany',
    'groupBy',
    'aggregate',
  ])('adds hospitalId to the where clause of %s, overriding any other value', (op) => {
    expect(scopeArgs('Patient', op, { where: { id: 'p1', hospitalId: OTHER } }, H).where).toEqual({
      id: 'p1',
      hospitalId: H,
    });
    expect(scopeArgs('Patient', op, undefined, H).where).toEqual({ hospitalId: H });
  });

  it('sets hospitalId on creates and rejects another hospital or a relation connect', () => {
    expect(scopeArgs('Department', 'create', { data: { name: 'Cardiology' } }, H).data).toEqual({
      name: 'Cardiology',
      hospitalId: H,
    });
    expect(
      scopeArgs(
        'Department',
        'createMany',
        { data: [{ name: 'A' }, { name: 'B', hospitalId: H }] },
        H,
      ).data,
    ).toEqual([
      { name: 'A', hospitalId: H },
      { name: 'B', hospitalId: H },
    ]);
    expect(() =>
      scopeArgs('Department', 'create', { data: { name: 'x', hospitalId: OTHER } }, H),
    ).toThrow(ForbiddenException);
    expect(() =>
      scopeArgs(
        'Department',
        'create',
        { data: { name: 'x', hospital: { connect: { id: OTHER } } } },
        H,
      ),
    ).toThrow(ForbiddenException);
  });

  it('never lets an update or upsert move a row to another hospital', () => {
    expect(() =>
      scopeArgs('Bed', 'update', { where: { id: 'b' }, data: { hospitalId: OTHER } }, H),
    ).toThrow(ForbiddenException);
    const up = scopeArgs(
      'Bed',
      'upsert',
      { where: { id: 'b' }, create: { label: '1' }, update: { label: '2' } },
      H,
    );
    expect(up).toEqual({
      where: { id: 'b', hospitalId: H },
      create: { label: '1', hospitalId: H },
      update: { label: '2' },
    });
    expect(() =>
      scopeArgs(
        'Bed',
        'upsert',
        { where: { id: 'b' }, create: {}, update: { hospitalId: OTHER } },
        H,
      ),
    ).toThrow(ForbiddenException);
  });

  it('scopes models whose hospitalId is optional (users, notifications, audit)', () => {
    expect(scopeArgs('User', 'findMany', {}, H).where).toEqual({ hospitalId: H });
    expect(scopeArgs('AuditLog', 'findMany', {}, H).where).toEqual({ hospitalId: H });
  });
});
