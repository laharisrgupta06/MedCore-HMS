import { expect, test } from '@playwright/test';

/**
 * Phase 3 routes against the real stack. The signed-in booking journey needs seeded hospital,
 * doctor, schedule and patient accounts (P14 seed data); until the seed exists it is covered by the
 * API integration suite (appointments.int-spec.ts) and the web component tests.
 */
test.describe('appointment routes', () => {
  for (const path of [
    '/portal/book',
    '/portal/appointments',
    '/dashboard/appointments',
    '/dashboard/availability',
  ]) {
    test(`${path} requires sign-in`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path)}`));
    });
  }
});
