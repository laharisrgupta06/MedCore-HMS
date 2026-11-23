import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsEmail, IsString, MinLength, ValidateNested } from 'class-validator';
import { createValidationPipe } from './validation';

class AddressDto {
  @IsString()
  @MinLength(2)
  city!: string;
}
class SampleDto {
  @IsEmail()
  email!: string;
  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;
}

describe('global validation pipe', () => {
  const pipe = createValidationPipe();
  const meta = { type: 'body' as const, metatype: SampleDto };

  it('returns VALIDATION_ERROR with dotted field paths', async () => {
    const err = await pipe
      .transform({ email: 'nope', address: { city: 'x' } }, meta)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    const body = (err as BadRequestException).getResponse() as {
      code: string;
      details: { field: string }[];
    };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details.map((d) => d.field).sort()).toEqual(['address.city', 'email']);
  });

  it('rejects unknown properties', async () => {
    const err = await pipe
      .transform({ email: 'a@b.com', address: { city: 'Pune' }, isAdmin: true }, meta)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
  });

  it('passes valid input through as a DTO instance', async () => {
    const out = await pipe.transform({ email: 'a@b.com', address: { city: 'Pune' } }, meta);
    expect(out).toBeInstanceOf(SampleDto);
  });
});
