import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';
import { CommonErrorCode, type FieldError } from '@medcore/types';

/** Flattens class-validator errors (including nested objects) into dotted field paths. */
export function flattenValidationErrors(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own: FieldError[] = e.constraints
      ? [{ field, messages: Object.values(e.constraints) }]
      : [];
    return [...own, ...flattenValidationErrors(e.children ?? [], field)];
  });
}

/** Global DTO validation (PRD section 10: class-validator + class-transformer on NestJS DTOs). */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new BadRequestException({
        code: CommonErrorCode.VALIDATION_ERROR,
        message: 'Request validation failed',
        details: flattenValidationErrors(errors),
      }),
  });
}
