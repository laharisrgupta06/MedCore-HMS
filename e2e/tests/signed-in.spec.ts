import { expect, test, type APIRequestContext } from '@playwright/test';
import { ACCOUNTS, stateFile, type AccountKey } from '../support/accounts';

/**
 * Signed-in foundations (DEC-061): every seeded role reaches its home page, and patients and other
 * hospitals cannot read a patient's record by id (TEN-002/003, PRD SEC). Later phases add journeys.
 */
const data = async (r: Awaited<ReturnType<APIRequestContext['get']>>) =>
  ((await r.json()) as { data: Record<string, unknown> }).data;

for (const key of Object.keys(ACCOUNTS) as AccountKey[]) {
  test.describe(`${key} signed in`, () => {
    test.use({ storageState: stateFile(key) });
    test('reaches its home page without signing in again', async ({ page }) => {
      const home = ACCOUNTS[key].home.source.includes('portal') ? '/portal' : '/dashboard';
      await page.goto(home);
      await expect(page).toHaveURL(ACCOUNTS[key].home);
      await expect(page).not.toHaveURL(/\/login/);
    });
  });
}

test.describe('patient isolation', () => {
  test('another patient and another hospital get 404 for a patient by id', async ({
    playwright,
  }) => {
    const as = (key: AccountKey) =>
      playwright.request.newContext({
        baseURL: 'http://localhost:3100',
        storageState: stateFile(key),
      });
    const owner = await as('patient-a');
    const me = await owner.get('/api/patients/me');
    expect(me.status()).toBe(200);
    const patientId = (await data(me)).id as string;
    expect((await owner.get(`/api/patients/${patientId}`)).status()).toBe(200);

    for (const other of ['patient-2-a', 'patient-b', 'hospital-admin-b'] as const) {
      const ctx = await as(other);
      expect((await ctx.get(`/api/patients/${patientId}`)).status(), other).toBe(404);
      await ctx.dispose();
    }
    await owner.dispose();
  });
});
