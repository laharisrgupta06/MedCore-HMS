import { describe, expect, it } from 'vitest';
import { homeFor, safeNext } from './auth';

describe('post sign-in redirect', () => {
  it('sends each role to its area', () => {
    expect(homeFor('PATIENT')).toBe('/portal');
    for (const r of [
      'SUPER_ADMIN',
      'HOSPITAL_ADMIN',
      'DOCTOR',
      'NURSE',
      'RECEPTIONIST',
      'LAB_TECHNICIAN',
      'PHARMACIST',
      'ACCOUNTANT',
    ] as const)
      expect(homeFor(r)).toBe('/dashboard');
  });
  it('honours a same-area ?next= and rejects open redirects or the wrong area', () => {
    expect(safeNext('/dashboard/account', 'DOCTOR')).toBe('/dashboard/account');
    expect(safeNext('/portal/account', 'PATIENT')).toBe('/portal/account');
    expect(safeNext('/portal', 'DOCTOR')).toBe('/dashboard');
    expect(safeNext('//evil.example', 'DOCTOR')).toBe('/dashboard');
    expect(safeNext('https://evil.example', 'PATIENT')).toBe('/portal');
    expect(safeNext('/\\evil.example', 'PATIENT')).toBe('/portal');
    expect(safeNext(null, 'NURSE')).toBe('/dashboard');
  });
});
