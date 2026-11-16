import { expect, test } from '@playwright/test';

/**
 * Phase 1D authentication screens against the real stack (pnpm infra:up, pnpm dev).
 * The full register → Mailpit code → sign-in journey is in journeys.spec.ts (needs a verified hospital).
 */
test.describe('public and authentication pages', () => {
  test('home page links to sign-in and registration, footer links resolve', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.getByRole('link', { name: 'Sign in' }).first().click();
    await expect(page).toHaveURL(/\/login$/);
    for (const name of ['Privacy Policy', 'Terms and Conditions']) {
      await page.getByRole('link', { name }).click();
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    }
  });

  test('sign-in validates input and reports wrong credentials from the API', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter your email address.')).toBeVisible();
    await page.getByLabel(/^Email/).fill('nobody-e2e@example.com');
    await page.getByLabel(/^Password/).fill('Wrong-password-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('Email or password is incorrect.');
  });

  test('registration rejects an unknown hospital code', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel(/^Hospital code/).fill('NO-SUCH-CODE');
    await page.getByLabel(/^First name/).fill('E2E');
    await page.getByLabel(/^Last name/).fill('Patient');
    await page.getByLabel(/^Email/).fill(`e2e-${Date.now()}@example.com`);
    await page.getByLabel(/^Date of birth/).fill('1990-01-01');
    await page.getByLabel(/^Gender/).selectOption('UNDISCLOSED');
    await page.getByLabel(/^Password \(required\)/).fill('E2e-password-1');
    await page.getByLabel(/^Confirm password/).fill('E2e-password-1');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText(/No active hospital uses this code/)).toBeVisible();
  });

  test('protected areas redirect to sign-in', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
    await page.goto('/portal/account');
    await expect(page).toHaveURL(/\/login\?next=%2Fportal%2Faccount/);
  });

  test('reset page without a token offers a new link; unknown routes show the 404 page', async ({
    page,
  }) => {
    await page.goto('/reset-password');
    await expect(page.getByText('This reset link cannot be used')).toBeVisible();
    await page.goto('/no-such-page');
    await expect(page.getByRole('heading', { name: 'This page does not exist' })).toBeVisible();
  });

  test('no horizontal overflow on the sign-in and registration pages', async ({ page }) => {
    for (const path of ['/login', '/register', '/']) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow, path).toBe(false);
    }
  });
});
