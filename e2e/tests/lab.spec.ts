import { expect, test } from '@playwright/test';

/** Phase 6 routes against the real stack; signed-in journeys await seed data (P14). */
test.describe('lab routes', () => {
  for (const path of [
    '/dashboard/lab',
    '/dashboard/lab/samples',
    '/dashboard/lab/tests',
    '/dashboard/lab/orders/00000000-0000-0000-0000-000000000000',
    '/portal/lab-reports',
  ]) {
    test(`${path} requires sign-in`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path)}`));
    });
  }
});
