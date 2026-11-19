import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dbError, isRetryable, mapDbRuleError, withRetry } from './db-rule-errors';

/** The shape Prisma gives a PostgreSQL error raised by a trigger or constraint during a query. */
const pgError = (code: string, message: string, detail = 'None') =>
  new Prisma.PrismaClientUnknownRequestError(
    `Invalid \`prisma.x.create()\` invocation:\n\nError occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "${code}", message: "${message}", severity: "ERROR", detail: ${detail}, column: None, hint: None }), transient: false })`,
    { clientVersion: 'test' },
  );

describe('database rule errors', () => {
  it('reads SQLSTATE and message', () => {
    expect(dbError(pgError('23000', 'A GST registration is never edited'))).toEqual({
      code: '23000',
      message: 'A GST registration is never edited',
    });
  });

  it('passes on our own trigger messages as 409 RULE_VIOLATION', () => {
    expect(() =>
      mapDbRuleError(
        pgError('23000', 'A tax classification used as a hospital default cannot be deactivated'),
      ),
    ).toThrow(
      expect.objectContaining({
        response: {
          code: 'RULE_VIOLATION',
          message: 'A tax classification used as a hospital default cannot be deactivated',
        },
      }),
    );
  });

  it('never passes on the GSTIN exclusion detail, which names another hospital', () => {
    const e = pgError(
      '23P01',
      'conflicting key value violates exclusion constraint \\"hospital_gst_registrations_gstin_one_hospital\\"',
      'Some("Key (gstin, \\"hospitalId\\")=(27AAPFU0939F1ZV, 6f1c0000-0000-4000-8000-000000000001) conflicts")',
    );
    try {
      mapDbRuleError(e);
      throw new Error('not thrown');
    } catch (x) {
      expect(x).toBeInstanceOf(ConflictException);
      const body = JSON.stringify((x as ConflictException).getResponse());
      expect(body).toContain('GSTIN_UNAVAILABLE');
      expect(body).not.toContain('6f1c0000');
    }
  });

  it("maps a named CHECK constraint to the caller's 400", () => {
    const e = pgError(
      '23514',
      'new row for relation \\"hospital_gst_registrations\\" violates check constraint \\"hospital_gst_registrations_details_chk\\"',
    );
    expect(() =>
      mapDbRuleError(e, {
        hospital_gst_registrations_details_chk: { code: 'GSTIN_INVALID', message: 'x' },
      }),
    ).toThrow(BadRequestException);
  });

  it('rethrows anything it does not recognise', () => {
    const e = new Error('boom');
    expect(() => mapDbRuleError(e)).toThrow(e);
  });

  it('retries serialization failures and deadlocks, then reports a conflict', async () => {
    expect(isRetryable(pgError('40001', 'could not serialize access'))).toBe(true);
    expect(isRetryable(pgError('40P01', 'deadlock detected'))).toBe(true);
    expect(
      isRetryable(
        new Prisma.PrismaClientKnownRequestError('x', { code: 'P2034', clientVersion: 't' }),
      ),
    ).toBe(true);
    let calls = 0;
    await expect(
      withRetry(async () => (++calls < 3 ? Promise.reject(pgError('40001', 's')) : 'ok')),
    ).resolves.toBe('ok');
    expect(calls).toBe(3);
    calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw pgError('40P01', 'd');
      }),
    ).rejects.toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'CONCURRENT_UPDATE' }) }),
    );
    expect(calls).toBe(3);
    await expect(
      withRetry(async () => {
        throw new Error('other');
      }),
    ).rejects.toThrow('other');
  });
});
