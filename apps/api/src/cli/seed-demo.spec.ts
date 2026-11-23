import { inflateSync } from 'node:zlib';
import {
  DEMO_ACCOUNTS,
  DEMO_DOCTORS,
  DEMO_DOMAIN,
  DEMO_IDS,
  DEMO_PORTAL_PATIENTS,
  assertSafeDemoTarget,
  signaturePng,
} from './seed-demo';

describe('Demo seed safety', () => {
  const ok = {
    DATABASE_URL: 'postgresql://u:secret-pw@localhost:5432/medcore?schema=public',
    DEMO_CONFIRM_DB: 'medcore',
    NODE_ENV: 'development',
    SMTP_HOST: 'localhost',
  };

  it('accepts a confirmed, non-test database outside production with local mail', () => {
    expect(assertSafeDemoTarget(ok)).toBe('medcore');
  });

  it('refuses production', () => {
    expect(() => assertSafeDemoTarget({ ...ok, NODE_ENV: 'production' })).toThrow(/production/);
  });

  it.each(['medcore_e2e', 'medcore_int', 'medcore_ci'])('refuses the test database %s', (db) => {
    expect(() =>
      assertSafeDemoTarget({
        ...ok,
        DATABASE_URL: `postgresql://u:p@localhost:5432/${db}`,
        DEMO_CONFIRM_DB: db,
      }),
    ).toThrow(/test database/);
  });

  it('requires the database name to be confirmed', () => {
    expect(() => assertSafeDemoTarget({ ...ok, DEMO_CONFIRM_DB: undefined })).toThrow(
      /DEMO_CONFIRM_DB=medcore/,
    );
    expect(() => assertSafeDemoTarget({ ...ok, DEMO_CONFIRM_DB: 'medcore_other' })).toThrow(
      /DEMO_CONFIRM_DB/,
    );
  });

  it('refuses a non-local mail server and a real payment provider', () => {
    expect(() => assertSafeDemoTarget({ ...ok, SMTP_HOST: 'smtp.example.com' })).toThrow(
      /SMTP_HOST/,
    );
    expect(() => assertSafeDemoTarget({ ...ok, PAYMENT_PROVIDER: 'stripe' })).toThrow(
      /test provider/,
    );
  });

  it('never puts the database password in an error message', () => {
    expect(() => assertSafeDemoTarget({ ...ok, DEMO_CONFIRM_DB: 'x' })).toThrow(
      expect.not.objectContaining({ message: expect.stringContaining('secret-pw') }),
    );
  });
});

describe('Demo seed data', () => {
  const emails = [
    ...DEMO_ACCOUNTS.map((a) => a.email),
    ...DEMO_DOCTORS.map((d) => d.email),
    ...DEMO_PORTAL_PATIENTS.map((p) => p.email),
  ];

  it('uses only the reserved example domain, never an E2E address, each e-mail once', () => {
    expect(DEMO_DOMAIN).toMatch(/\.example$/);
    for (const e of emails) {
      expect(e.endsWith(`@${DEMO_DOMAIN}`)).toBe(true);
      expect(e).not.toMatch(/e2e|medcore\.test/);
    }
    expect(new Set(emails).size).toBe(emails.length);
  });

  it('uses fixed version-4 ids (the API validates ids as UUID v4)', () => {
    const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (const id of [DEMO_IDS.hospital, ...Object.values(DEMO_IDS.dept)]) expect(id).toMatch(v4);
  });

  it('has a senior lab technician and a second one, so results can be approved by another person', () => {
    const lab = DEMO_ACCOUNTS.filter((a) => a.role === 'LAB_TECHNICIAN');
    expect(lab.filter((a) => a.senior)).toHaveLength(1);
    expect(lab.filter((a) => !a.senior)).toHaveLength(1);
  });

  it('draws a valid greyscale PNG signature, well under the 512 KB upload limit', () => {
    const png = signaturePng(1);
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(png.length).toBeLessThan(512 * 1024);
    expect(png.readUInt32BE(16)).toBe(240); // IHDR width
    expect(png.readUInt32BE(20)).toBe(60); // IHDR height
    const idatLength = png.readUInt32BE(33);
    expect(png.subarray(37, 41).toString('ascii')).toBe('IDAT');
    const pixels = inflateSync(png.subarray(41, 41 + idatLength));
    expect(pixels.length).toBe((240 + 1) * 60);
    expect([...pixels].some((v) => v === 40)).toBe(true); // the pen stroke is drawn
    expect(signaturePng(1).equals(png)).toBe(true); // deterministic
  });
});
