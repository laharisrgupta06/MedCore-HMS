import { ApiPropertyOptional } from '@nestjs/swagger';
import { ALL_ROLES, type Role } from '@medcore/types';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const E164 = /^\+[1-9]\d{7,14}$/;
const NAME = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u;
const toBool = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class ListUsersQuery {
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

  @ApiPropertyOptional({ description: 'Matches first name, last name or email' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: ALL_ROLES })
  @IsOptional()
  @IsIn(ALL_ROLES)
  role?: Role;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Super Admin only; other roles are limited to their hospital',
  })
  @IsOptional()
  @IsUUID()
  hospitalId?: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  @Matches(NAME, { message: 'firstName contains unsupported characters' })
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  @Matches(NAME, { message: 'lastName contains unsupported characters' })
  lastName?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'E.164; changing it clears phone verification',
  })
  @IsOptional()
  @Transform(trim)
  @ValidateIf((_, v) => v !== null)
  @Matches(E164, { message: 'phone must be in international format, for example +919876543210' })
  phone?: string | null;

  @ApiPropertyOptional({ description: 'Administrators only' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
