import { test as base, type Browser } from '@playwright/test';
import { ACCOUNTS, type AccountKey } from './accounts';

/**
 * A fresh signed-in session for each test (DEC-061). MedCore rotates the refresh token on every
 * silent refresh and treats a replayed token as theft: every session of that user is revoked
 * (ARCHITECTURE §6). Tests that shared one saved session therefore revoked each other part-way
 * through a run. Each test now signs in through the real sign-in page in a throwaway context and
 * starts with its own session, like two different people signing in.
 */
export async function signedInState(browser: Browser, key: AccountKey, baseURL: string) {
  const password = process.env.E2E_PASSWORD;
  if (!password) throw new Error('E2E_PASSWORD was not passed on by global-setup.');
  const { email, home } = ACCOUNTS[key];
  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    await page.goto('/login');
    await page.getByLabel(/^Email/).fill(email);
    await page.getByLabel(/^Password/).fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(home, { timeout: 20_000 });
    return await context.storageState();
  } finally {
    await context.close();
  }
}

/** `test.use({ account: 'patient-a' })` signs that account in for each test of the block. */
export const test = base.extend<{ account: AccountKey | undefined }>({
  account: [undefined, { option: true }],
  storageState: async ({ account, storageState, browser, baseURL }, use) => {
    if (!account) return use(storageState);
    await use(await signedInState(browser, account, baseURL ?? 'http://localhost:3100'));
  },
});

export { expect } from '@playwright/test';
