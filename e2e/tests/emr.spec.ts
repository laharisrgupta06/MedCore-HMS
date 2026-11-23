import { expect, test } from '@playwright/test';

/**
 * Phase 4 routes against the real stack. The signed-in encounter journey needs seed data (P14);
 * until then it is covered by test/emr.int-spec.ts and the web component tests.
 */
test.describe('medical record routes', () => {
  for (const path of [
    '/portal/health',
    '/portal/records/00000000-0000-4000-8000-000000000000',
    '/dashboard/records/00000000-0000-4000-8000-000000000000',
    '/dashboard/patients/00000000-0000-4000-8000-000000000000',
    '/dashboard/encounters/00000000-0000-4000-8000-000000000000',
  ]) {
    test(`${path} requires sign-in`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path)}`));
    });
  }
});
