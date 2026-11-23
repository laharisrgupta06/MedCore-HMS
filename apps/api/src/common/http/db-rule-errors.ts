import { BadRequestException, ConflictException, HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Translates refusals from MedCore's own database rules (triggers, CHECK and exclusion constraints)
 * into API errors (Phase 8, DEC-050, DEC-058, SECURITY R-12).
 *
 * - Our trigger messages (SQLSTATE 23000) are written for people and name no other record, so they are
 *   passed on with code RULE_VIOLATION (409).
 * - A named CHECK constraint becomes 400 with the field-level code the caller supplies.
 * - The GSTIN exclusion constraint becomes 409 GSTIN_UNAVAILABLE; its database detail names another
 *   hospital, so it is never passed on.
 * - Serialization failures and deadlocks are reported as retryable (isRetryable) for withRetry.
 * Anything else is rethrown unchanged (500, details hidden by the global filter).
 */
export interface DbError {
  code: string | null;
  message: string | null;
}

/** SQLSTATE and message of a PostgreSQL error carried by any Prisma error type. */
export function dbError(e: unknown): DbError {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
    return { code: '40001', message: null };
  }
  if (
    e instanceof Prisma.PrismaClientKnownRequestError ||
    e instanceof Prisma.PrismaClientUnknownRequestError
  ) {
    const text = e.message;
    const code =
      /code: "([0-9A-Z]{5})"/.exec(text)?.[1] ??
      /SQLSTATE[ :]+([0-9A-Z]{5})/.exec(text)?.[1] ??
      null;
    const message = /message: "((?:[^"\\]|\\.)*)"/.exec(text)?.[1]?.replace(/\\"/g, '"') ?? null;
    return { code, message };
  }
  return { code: null, message: null };
}

export function isRetryable(e: unknown): boolean {
  const { code } = dbError(e);
  return code === '40001' || code === '40P01';
}

/** Runs fn, retrying up to `attempts` times on serialization failures and deadlocks (DEC-058, R-16). */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isRetryable(e)) throw e;
      if (i >= attempts) {
        throw new ConflictException({
          code: 'CONCURRENT_UPDATE',
          message: 'Someone else changed these settings at the same moment. Please try again.',
        });
      }
    }
  }
}

/**
 * The text a constraint name is looked for in: PostgreSQL's own message and Prisma's structured
 * metadata. Never the whole Prisma error message, which also prints lines of the calling source
 * code; a nearby line naming a constraint (for example a pre-check that throws that constraint's
 * error) would otherwise be taken for the database's reason.
 */
function databaseText(e: unknown, message: string | null): string {
  const meta =
    e instanceof Prisma.PrismaClientKnownRequestError && e.meta ? JSON.stringify(e.meta) : '';
  if (message !== null) return `${message} ${meta}`;
  const full = e instanceof Error ? e.message : '';
  // No PostgreSQL message to read: drop Prisma's code frame ("  423 |  ...", "→ 426   ...").
  const withoutCode = full
    .split('\n')
    .filter((line) => !/^\s*(→\s*)?\d+\s*(\||\s)/.test(line))
    .join('\n');
  return `${withoutCode} ${meta}`;
}

/**
 * Maps a database rule refusal. `checks` maps a CHECK constraint name to the 400 response for it.
 */
export function mapDbRuleError(
  e: unknown,
  checks: Record<string, { code: string; message: string }> = {},
): never {
  if (e instanceof HttpException) throw e;
  const { code, message } = dbError(e);
  const text = databaseText(e, message);
  if (code === '23P01' || text.includes('hospital_gst_registrations_gstin_one_hospital')) {
    throw new ConflictException({
      code: 'GSTIN_UNAVAILABLE',
      message: 'This GSTIN is already registered to another hospital on MedCore.',
    });
  }
  for (const [constraint, response] of Object.entries(checks)) {
    if (text.includes(constraint)) throw new BadRequestException(response);
  }
  if (code === '23000' && message) {
    throw new ConflictException({ code: 'RULE_VIOLATION', message });
  }
  throw e;
}
