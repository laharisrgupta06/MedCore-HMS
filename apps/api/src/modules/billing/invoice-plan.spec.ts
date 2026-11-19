import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { discountShares, finaliseBlockers, totalsOf } from '@medcore/types';
import { mapInvoiceDbError } from './invoice-db-errors';

/** T-BILL-PLAN-001: invoice arithmetic and M-11b refusal mapping (task 8-B3). */
const pg = (code: string, message: string) =>
  new Prisma.PrismaClientUnknownRequestError(
    `ConnectorError(ConnectorError { kind: QueryError(PostgresError { code: "${code}", message: "${message}", severity: "ERROR", detail: None }) })`,
    { clientVersion: 't' },
  );

describe('invoice arithmetic', () => {
  it('totals equal the sum of the lines (plan worked example)', () => {
    expect(
      totalsOf([
        { taxableValue: '450.00', taxAmount: '0.00', discountShare: '50.00' },
        { taxableValue: '102.86', taxAmount: '5.14', discountShare: '12.00' },
      ]),
    ).toEqual({ subtotal: '552.86', taxAmount: '5.14', discountAmount: '62.00', total: '558.00' });
    expect(totalsOf([])).toEqual({
      subtotal: '0.00',
      taxAmount: '0.00',
      discountAmount: '0.00',
      total: '0.00',
    });
  });
  it('discount shares in line order', () => {
    expect(discountShares(['500.00', '120.00'], '62')).toEqual(['50.00', '12.00']);
  });
  it('finalise blockers in the database order', () => {
    const l = (o: object) => ({
      unclassified: false,
      taxableValue: '100.00',
      taxAmount: '0.00',
      discountShare: '0.00',
      serviceDate: '2026-11-18',
      ...o,
    });
    expect(
      finaliseBlockers({ taxSetupConfirmed: true, lines: [l({})], issueDate: '2026-11-18' }),
    ).toEqual([]);
    expect(
      finaliseBlockers({ taxSetupConfirmed: false, lines: [], issueDate: '2026-11-18' }),
    ).toEqual(['TAX_SETUP_UNCONFIRMED', 'EMPTY_INVOICE']);
    expect(
      finaliseBlockers({
        taxSetupConfirmed: true,
        lines: [l({ unclassified: true }), l({ taxableValue: '0.00' })],
        issueDate: '2026-11-18',
      }),
    ).toEqual(['UNCLASSIFIED_LINES']);
    expect(
      finaliseBlockers({
        taxSetupConfirmed: true,
        lines: [l({ taxableValue: '0.00', discountShare: '100.00' })],
        issueDate: '2026-11-18',
      }),
    ).toEqual(['NOTHING_TO_PAY']);
    expect(
      finaliseBlockers({
        taxSetupConfirmed: true,
        lines: [l({ serviceDate: '2026-11-19' })],
        issueDate: '2026-11-18',
      }),
    ).toEqual(['LINE_AFTER_ISSUE_DATE']);
  });
});

describe('M-11b refusals become API errors', () => {
  const code = (e: unknown) => {
    try {
      mapInvoiceDbError(e);
    } catch (x) {
      return x instanceof ConflictException
        ? (x.getResponse() as { code: string }).code
        : 'rethrown';
    }
    return 'none';
  };
  it.each([
    ['23000', 'Lines of an issued or void invoice cannot change', 'NOT_DRAFT'],
    [
      '23000',
      'This document has been issued and cannot be cancelled in MedCore; record a correction request for the accountant',
      'DOCUMENT_ISSUED',
    ],
    [
      '23000',
      'This document has been issued and cannot be changed in MedCore; record a correction request for the accountant',
      'DOCUMENT_ISSUED',
    ],
    [
      '23505',
      'duplicate key value violates unique constraint \\"invoices_one_draft_per_appointment\\"',
      'INVOICE_EXISTS',
    ],
    [
      '23505',
      'duplicate key value violates unique constraint \\"invoice_items_lab_unreleased\\"',
      'ALREADY_BILLED',
    ],
    [
      '23505',
      'duplicate key value violates unique constraint \\"invoice_items_dispense_unreleased\\"',
      'ALREADY_BILLED',
    ],
    ['23000', 'This visit is already charged a consultation', 'ALREADY_BILLED'],
    [
      '23000',
      'Lines without a tax classification must be classified and re-resolved before finalising',
      'UNCLASSIFIED_LINES',
    ],
    [
      '23000',
      'The hospital admin must confirm the tax set-up before the first invoice is finalised',
      'TAX_DEFAULTS_UNCONFIRMED',
    ],
    [
      '23000',
      'SERIES_EXHAUSTED: series BOS for 26-27 has issued all 99,999 numbers; the hospital admin must open a series with a new prefix',
      'SERIES_EXHAUSTED',
    ],
    [
      '23000',
      'The line tax snapshot does not match the tax settings in force on 2026-11-19 (gstCollected); re-resolve the line',
      'SNAPSHOT_STALE',
    ],
  ])('%s %s', (c, m, expected) => {
    expect(code(pg(c, m))).toBe(expected);
  });
  it('the issued-document message names the accountant and the process outside MedCore', () => {
    try {
      mapInvoiceDbError(
        pg('23000', 'This document has been issued and cannot be cancelled in MedCore; x'),
      );
    } catch (x) {
      expect(JSON.stringify((x as ConflictException).getResponse())).toMatch(
        /accountant must handle it .* outside MedCore/,
      );
    }
  });
  it('series exhaustion message drops the code prefix; unknown errors are rethrown', () => {
    try {
      mapInvoiceDbError(pg('23000', 'SERIES_EXHAUSTED: series BOS is full'));
    } catch (x) {
      expect((x as ConflictException).getResponse()).toEqual({
        code: 'SERIES_EXHAUSTED',
        message: 'series BOS is full',
      });
    }
    const other = new Error('boom');
    expect(code(other)).toBe('rethrown');
  });
});
