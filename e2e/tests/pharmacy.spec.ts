import { expect, test } from '@playwright/test';

/** Phase 7 routes against the real stack; signed-in journeys await seed data (P14). */
test.describe('pharmacy routes', () => {
  for (const path of [
    '/dashboard/pharmacy',
    '/dashboard/pharmacy/alerts',
    '/dashboard/pharmacy/prescriptions/00000000-0000-0000-0000-000000000000',
  ]) {
    test(`${path} requires sign-in`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path)}`));
    });
  }
});
