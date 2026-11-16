import { validateSuperAdmin } from './create-super-admin';

describe('create-super-admin input validation (DEC-013)', () => {
  const ok = {
    email: 'root@medcore.test',
    firstName: 'Ada',
    lastName: 'Root',
    password: 'Strong-pass-9',
  };
  it('accepts valid input', () => expect(validateSuperAdmin(ok)).toBeNull());
  it('rejects a bad email, missing names and weak passwords', () => {
    expect(validateSuperAdmin({ ...ok, email: 'nope' })).toMatch(/email/);
    expect(validateSuperAdmin({ ...ok, lastName: ' ' })).toMatch(/name/);
    expect(validateSuperAdmin({ ...ok, password: 'short1' })).toMatch(/10 to 128/);
    expect(validateSuperAdmin({ ...ok, password: 'nodigitshere' })).toMatch(
      /letter and one number/,
    );
  });
});
