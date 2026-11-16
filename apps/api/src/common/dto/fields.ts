import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/** Shared DTO building blocks so every module validates the same way (SEC-011). */
export const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const lowerTrim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const emptyToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? null : t;
};

export const E164 = /^\+[1-9]\d{7,14}$/;
export const PERSON_NAME = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u;

export function PersonName(label: string, optional = false) {
  return applyDecorators(
    optional ? ApiPropertyOptional() : ApiProperty(),
    ...(optional ? [IsOptional()] : []),
    Transform(trim),
    IsString(),
    Length(1, 80),
    Matches(PERSON_NAME, { message: `${label} contains unsupported characters` }),
  );
}

export function Email(optional = false) {
  return applyDecorators(
    optional ? ApiPropertyOptional() : ApiProperty({ example: 'name@example.com' }),
    ...(optional ? [IsOptional()] : []),
    Transform(lowerTrim),
    IsEmail(),
    MaxLength(254),
  );
}

/** Optional E.164 phone; an empty string clears it (null). */
export function Phone(required = false) {
  return applyDecorators(
    required
      ? ApiProperty({ example: '+919876543210' })
      : ApiPropertyOptional({ nullable: true, example: '+919876543210' }),
    ...(required ? [] : [IsOptional(), Transform(emptyToNull)]),
    ValidateIf((_, v) => v !== null),
    Matches(E164, { message: 'phone must be in international format, for example +919876543210' }),
  );
}

/** Optional free text; empty string becomes null. */
export function Text(max: number, optional = true) {
  return applyDecorators(
    optional
      ? ApiPropertyOptional({ nullable: true, maxLength: max })
      : ApiProperty({ maxLength: max }),
    ...(optional ? [IsOptional(), Transform(emptyToNull)] : [Transform(trim)]),
    ValidateIf((_, v) => v !== null),
    IsString(),
    ...(optional ? [MaxLength(max)] : [Length(1, max)]),
  );
}

export class PageQuery {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({ description: 'Free-text search' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;
}

export const skipTake = (q: PageQuery) => ({ skip: (q.page - 1) * q.limit, take: q.limit });
