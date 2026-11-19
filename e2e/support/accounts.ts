import { resolve } from 'node:path';

/**
 * Seeded E2E accounts (apps/api/src/cli/seed-e2e.ts, DEC-061). The e-mail scheme matches the seed;
 * the password is E2E_PASSWORD from the repository-root .env, never written in the repository.
 */
export type Hospital = 'a' | 'b';
export type AccountKey =
  | 'super-admin'
  | 'hospital-admin-a'
  | 'doctor-a'
  | 'nurse-a'
  | 'receptionist-a'
  | 'lab-technician-a'
  | 'pharmacist-a'
  | 'accountant-a'
  | 'patient-a'
  | 'patient-2-a'
  | 'hospital-admin-b'
  | 'patient-b';

export const ACCOUNTS: Record<AccountKey, { email: string; home: RegExp }> = {
  'super-admin': { email: 'e2e-super-admin@medcore.test', home: /\/dashboard/ },
  'hospital-admin-a': { email: 'e2e-hospital-admin-a@medcore.test', home: /\/dashboard/ },
  'doctor-a': { email: 'e2e-doctor-a@medcore.test', home: /\/dashboard/ },
  'nurse-a': { email: 'e2e-nurse-a@medcore.test', home: /\/dashboard/ },
  'receptionist-a': { email: 'e2e-receptionist-a@medcore.test', home: /\/dashboard/ },
  'lab-technician-a': { email: 'e2e-lab-technician-a@medcore.test', home: /\/dashboard/ },
  'pharmacist-a': { email: 'e2e-pharmacist-a@medcore.test', home: /\/dashboard/ },
  'accountant-a': { email: 'e2e-accountant-a@medcore.test', home: /\/dashboard/ },
  'patient-a': { email: 'e2e-patient-a@medcore.test', home: /\/portal/ },
  'patient-2-a': { email: 'e2e-patient-2-a@medcore.test', home: /\/portal/ },
  'hospital-admin-b': { email: 'e2e-hospital-admin-b@medcore.test', home: /\/dashboard/ },
  'patient-b': { email: 'e2e-patient-b@medcore.test', home: /\/portal/ },
};

/** Saved browser state for an account (absolute path), written by global-setup.ts. */
export const stateFile = (key: AccountKey): string =>
  resolve(__dirname, '..', '.auth', `${key}.json`);
