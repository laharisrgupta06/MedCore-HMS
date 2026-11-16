import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { toErrorResponse } from './all-exceptions.filter';

describe('toErrorResponse', () => {
  it('keeps a module-specific code and message', () => {
    const r = toErrorResponse(
      new ConflictException({
        code: 'SLOT_UNAVAILABLE',
        message: 'This slot was just booked by another patient.',
      }),
    );
    expect(r).toEqual({
      status: 409,
      body: {
        success: false,
        error: {
          code: 'SLOT_UNAVAILABLE',
          message: 'This slot was just booked by another patient.',
        },
      },
    });
  });

  it('maps default HTTP errors to common codes', () => {
    expect(toErrorResponse(new NotFoundException('Cannot GET /api/nope')).body.error.code).toBe(
      'NOT_FOUND',
    );
    expect(toErrorResponse(new ThrottlerException()).body.error.code).toBe('RATE_LIMITED');
    expect(toErrorResponse(new ThrottlerException()).status).toBe(429);
  });

  it('carries validation details', () => {
    const details = [{ field: 'email', messages: ['email must be an email'] }];
    const r = toErrorResponse(
      new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details,
      }),
    );
    expect(r.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details,
    });
  });

  it('never leaks internal error messages', () => {
    const r = toErrorResponse(new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'));
    expect(r).toEqual({
      status: 500,
      body: {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
      },
    });
    expect(
      toErrorResponse(new InternalServerErrorException('db password wrong')).body.error.message,
    ).toBe('An unexpected error occurred.');
  });

  it('maps Express middleware errors such as malformed JSON to 4xx', () => {
    const err = Object.assign(new SyntaxError('Unexpected token'), {
      status: 400,
      type: 'entity.parse.failed',
    });
    expect(toErrorResponse(err)).toEqual({
      status: 400,
      body: {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'The request could not be processed.' },
      },
    });
  });
});
