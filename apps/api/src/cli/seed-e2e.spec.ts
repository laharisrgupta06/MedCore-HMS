import { assertSafeE2eTarget, e2eEmail } from './seed-e2e';

describe('E2E seed safety (DEC-061)', () => {
  const ok = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/medcore_e2e?schema=public',
    MEDCORE_E2E: '1',
    NODE_ENV: 'development',
  };

  it('accepts only the E2E database with the E2E flag outside production', () => {
    expect(() => assertSafeE2eTarget(ok)).not.toThrow();
  });

  it.each(['medcore', 'postgres', 'medcore_e2e_copy', 'Medcore_E2E'])(
    'refuses database %s',
    (name) => {
      expect(() =>
        assertSafeE2eTarget({ ...ok, DATABASE_URL: `postgresql://u:p@localhost:5432/${name}` }),
      ).toThrow(/Refusing to seed/);
    },
  );

  it('refuses without the E2E flag, in production, or with no database URL', () => {
    expect(() => assertSafeE2eTarget({ ...ok, MEDCORE_E2E: undefined })).toThrow(/MEDCORE_E2E/);
    expect(() => assertSafeE2eTarget({ ...ok, NODE_ENV: 'production' })).toThrow(/production/);
    expect(() => assertSafeE2eTarget({ ...ok, DATABASE_URL: undefined })).toThrow(/not set/);
  });

  it('never puts the database password in an error message', () => {
    expect(() =>
      assertSafeE2eTarget({ ...ok, DATABASE_URL: 'postgresql://u:s3cret@h:5432/medcore' }),
    ).toThrow(expect.objectContaining({ message: expect.not.stringContaining('s3cret') }));
  });

  it('names accounts the way the Playwright suite expects', () => {
    expect(e2eEmail('HOSPITAL_ADMIN', 'a')).toBe('e2e-hospital-admin-a@medcore.test');
    expect(e2eEmail('PATIENT', 'a', 2)).toBe('e2e-patient-2-a@medcore.test');
    expect(e2eEmail('LAB_TECHNICIAN', 'b')).toBe('e2e-lab-technician-b@medcore.test');
  });
});
