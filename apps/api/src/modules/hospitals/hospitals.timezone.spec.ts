import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { isIanaTimeZone } from '../../common/dto/fields';
import { UpdateHospitalDto } from './hospitals.dto';
import { HospitalsService } from './hospitals.service';

/** Hospital time zone rules (8-B2, DEC-057). */
describe('hospital time zone', () => {
  it('accepts real IANA zones and refuses zone-shaped text', () => {
    for (const z of ['Asia/Kolkata', 'Europe/London', 'America/Argentina/Buenos_Aires', 'UTC'])
      expect(isIanaTimeZone(z)).toBe(true);
    for (const z of ['Asia/Atlantis', 'Mars/Olympus', 'kolkata', '', 'Asia/Kolkata; DROP', 42])
      expect(isIanaTimeZone(z)).toBe(false);
  });

  it('validates the update DTO with the real zone list', () => {
    const bad = validateSync(plainToInstance(UpdateHospitalDto, { timezone: 'Asia/Atlantis' }));
    expect(bad.map((e) => e.property)).toContain('timezone');
    expect(
      validateSync(plainToInstance(UpdateHospitalDto, { timezone: 'Asia/Kolkata' })),
    ).toHaveLength(0);
  });

  const hospital = (locked: boolean) => ({
    id: 'h1',
    name: 'H',
    code: 'H-1',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    taxRatePercent: '0',
    invoicePrefix: 'INV',
    status: 'ACTIVE',
    subscriptionStatus: 'ACTIVE',
    taxTimezoneLockedAt: locked ? new Date() : null,
    createdAt: new Date(),
  });
  const service = (
    row: ReturnType<typeof hospital>,
    update: jest.Mock = jest.fn(async (a: { data: object }) => ({ ...row, ...a.data })),
  ) => ({
    svc: new HospitalsService(
      { client: { hospital: { findUnique: async () => row, update } } } as never,
      {} as never,
      {} as never,
    ),
    update,
  });

  it('refuses a new time zone once tax dates use it, without writing', async () => {
    const { svc, update } = service(hospital(true));
    await expect(
      svc.update('h1', { timezone: 'Europe/London' } as UpdateHospitalDto),
    ).rejects.toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'TIMEZONE_LOCKED' }) }),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('still allows other edits, and resending the same zone, when locked', async () => {
    const { svc, update } = service(hospital(true));
    const out = await svc.update('h1', {
      timezone: 'Asia/Kolkata',
      name: 'New',
    } as UpdateHospitalDto);
    expect(update).toHaveBeenCalled();
    expect(out.timezoneLocked).toBe(true);
  });

  it('maps the database trigger refusal (lock stamped in between) to the same 409', async () => {
    const { svc } = service(
      hospital(false),
      jest.fn(async () => {
        throw new Error(
          'PostgresError { code: "23000", message: "The time zone of a hospital with tax versions or GST registrations cannot change" }',
        );
      }),
    );
    await expect(
      svc.update('h1', { timezone: 'Europe/London' } as UpdateHospitalDto),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
