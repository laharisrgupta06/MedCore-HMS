import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Gender, PASSWORD_POLICY } from '@medcore/types';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lowerTrim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const upperTrim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const E164 = /^\+[1-9]\d{7,14}$/;
const NAME = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u;

export class PasswordField {
  @ApiProperty({ description: PASSWORD_POLICY.description, minLength: 10, maxLength: 128 })
  @IsString()
  @Length(PASSWORD_POLICY.minLength, PASSWORD_POLICY.maxLength)
  @Matches(PASSWORD_POLICY.pattern, {
    message: 'password must contain at least one letter and one number',
  })
  password!: string;
}

export class RegisterDto extends PasswordField {
  @ApiProperty({
    example: 'CITYCARE',
    description: 'Code given to patients by their hospital (DEC-010)',
  })
  @Transform(upperTrim)
  @IsString()
  @Matches(/^[A-Z0-9-]{3,20}$/, {
    message: 'hospitalCode must be 3 to 20 letters, digits or hyphens',
  })
  hospitalCode!: string;

  @ApiProperty({ example: 'Asha' })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  @Matches(NAME, { message: 'firstName contains unsupported characters' })
  firstName!: string;

  @ApiProperty({ example: 'Rao' })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  @Matches(NAME, { message: 'lastName contains unsupported characters' })
  lastName!: string;

  @ApiProperty({ example: 'asha@example.com' })
  @Transform(lowerTrim)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional({ example: '+919876543210', description: 'E.164 format' })
  @IsOptional()
  @Transform(trim)
  @Matches(E164, { message: 'phone must be in international format, for example +919876543210' })
  phone?: string;

  @ApiProperty({ example: '1990-04-21', description: 'ISO date (YYYY-MM-DD)' })
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateOfBirth must be a date in YYYY-MM-DD format' })
  dateOfBirth!: string;

  @ApiProperty({ enum: Object.values(Gender) })
  @IsEnum(Gender)
  gender!: Gender;
}

export class LoginDto {
  @ApiProperty()
  @Transform(lowerTrim)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 128)
  password!: string;
}

export class EmailDto {
  @ApiProperty()
  @Transform(lowerTrim)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class OtpField {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'otp must be 6 digits' })
  otp!: string;
}

export class VerifyEmailDto extends OtpField {
  @ApiProperty()
  @Transform(lowerTrim)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto extends PasswordField {
  @ApiProperty()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/, { message: 'token is invalid' })
  token!: string;
}

export class LogoutDto {
  @ApiPropertyOptional({ description: 'Revoke every session of this user (all devices)' })
  @IsOptional()
  @IsBoolean()
  allDevices?: boolean;
}
