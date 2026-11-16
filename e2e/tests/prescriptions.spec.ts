import { expect, test } from '@playwright/test';

/** Phase 5 routes against the real stack; signed-in journeys await seed data (P14). */
test.describe('prescription routes', () => {
  for (const path of ['/portal/prescriptions', '/dashboard/medicines']) {
    test(`${path} requires sign-in`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path)}`));
    });
  }
});
