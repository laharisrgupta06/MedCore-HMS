import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { CommonErrorCode } from '@medcore/types';
import { Prisma } from '@prisma/client';

/**
 * Converts the Prisma errors that represent client mistakes into PRD error envelopes:
 * unique violation → 409 CONFLICT (naming the fields), foreign-key violation → 409 IN_USE,
 * record not found → 404. Anything else is rethrown unchanged (500, details hidden).
 */
export function mapPrismaError(
  e: unknown,
  messages: { conflict?: string; inUse?: string } = {},
): never {
  if (e instanceof HttpException) throw e;
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') {
      const target = e.meta?.target;
      const fields = (Array.isArray(target) ? target : [String(target ?? '')]).filter(
        (f) => f !== 'hospitalId',
      );
      throw new ConflictException({
        code: CommonErrorCode.CONFLICT,
        message: messages.conflict ?? 'A record with these details already exists.',
        details: { fields },
      });
    }
    if (e.code === 'P2003')
      throw new ConflictException({
        code: 'IN_USE',
        message: messages.inUse ?? 'This record is used elsewhere and cannot be changed this way.',
      });
    if (e.code === 'P2025')
      throw new NotFoundException({
        code: CommonErrorCode.NOT_FOUND,
        message: 'The requested resource was not found.',
      });
  }
  throw e;
}

export function notFound(what = 'resource'): NotFoundException {
  return new NotFoundException({
    code: CommonErrorCode.NOT_FOUND,
    message: `The ${what} was not found.`,
  });
}
