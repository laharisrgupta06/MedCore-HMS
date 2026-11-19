import { BadRequestException, ConflictException, HttpException } from '@nestjs/common';
import { InvoiceErrorCode } from '@medcore/types';
import { dbError } from '../../common/http/db-rule-errors';

/**
 * Translates the M-11b invoice rules' refusals into API errors (task 8-B3). The messages are the
 * database's own (written for people); the code lets screens react. Unrecognised errors are rethrown.
 */
const RULES: {
  match: RegExp | string;
  status: 400 | 409;
  code: InvoiceErrorCode;
  message?: string;
}[] = [
  { match: 'Lines of an issued or void invoice cannot change', status: 409, code: 'NOT_DRAFT' },
  { match: 'A draft cannot be paid', status: 409, code: 'NOT_DRAFT' },
  {
    match: 'cannot be cancelled in MedCore',
    status: 409,
    code: 'DOCUMENT_ISSUED',
    message:
      'This document has been issued and cannot be changed or cancelled in MedCore. Your accountant must handle it through the legally appropriate process, such as a credit note, outside MedCore. Record a correction request instead.',
  },
  {
    match: 'cannot be changed in MedCore',
    status: 409,
    code: 'DOCUMENT_ISSUED',
    message:
      'This document has been issued and cannot be changed or cancelled in MedCore. Your accountant must handle it through the legally appropriate process, such as a credit note, outside MedCore. Record a correction request instead.',
  },
  { match: 'A void invoice cannot change', status: 409, code: 'NOT_DRAFT' },
  {
    match: 'invoices_one_draft_per_appointment',
    status: 409,
    code: 'INVOICE_EXISTS',
    message: 'This visit already has a draft invoice.',
  },
  {
    match: 'invoices_one_original_per_appointment',
    status: 409,
    code: 'INVOICE_EXISTS',
    message: 'This visit already has an invoice; add later charges as a late-charge invoice.',
  },
  {
    match: 'invoices_appointmentId_sequence_key',
    status: 409,
    code: 'INVOICE_EXISTS',
    message: 'Another invoice for this visit was created at the same moment. Please try again.',
  },
  {
    match: /invoice_items_(lab|dispense|consultation)_unreleased|already charged a consultation/,
    status: 409,
    code: 'ALREADY_BILLED',
    message: 'This charge is already on an invoice of this visit.',
  },
  { match: 'needs at least one line', status: 409, code: 'EMPTY_INVOICE' },
  { match: 'must be classified and re-resolved', status: 409, code: 'UNCLASSIFIED_LINES' },
  { match: 'must confirm the tax set-up', status: 409, code: 'TAX_DEFAULTS_UNCONFIRMED' },
  { match: 'nothing to pay', status: 409, code: 'NOTHING_TO_PAY' },
  { match: 'SERIES_EXHAUSTED', status: 409, code: 'SERIES_EXHAUSTED' },
  {
    match: 'tax snapshot does not match',
    status: 409,
    code: 'SNAPSHOT_STALE',
    message: 'The tax settings changed while this charge was being added. Please try again.',
  },
];

export function mapInvoiceDbError(e: unknown): never {
  if (e instanceof HttpException) throw e;
  const { message } = dbError(e);
  const text = `${message ?? ''} ${e instanceof Error ? e.message : ''}`;
  for (const r of RULES) {
    const hit = typeof r.match === 'string' ? text.includes(r.match) : r.match.test(text);
    if (!hit) continue;
    const body = {
      code: r.code,
      message:
        r.message ?? (message ?? 'This change is not allowed.').replace(/^SERIES_EXHAUSTED: /, ''),
    };
    throw r.status === 400 ? new BadRequestException(body) : new ConflictException(body);
  }
  throw e;
}
