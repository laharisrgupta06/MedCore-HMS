import type { AccountKey } from '../support/accounts';
import { expect, test } from '../support/session';

/**
 * Phase 13: signed-in smoke journeys for the Phase 8–11 screens (billing, payments, claims,
 * notifications, portal dashboard, analytics, search). They check that each screen loads for the
 * role that may use it and is refused for one that may not. No payment is recorded here; payments
 * are covered through the API on PostgreSQL (apps/api/test/payments-and-portal.int-spec.ts).
 */
const heading = (page: import('@playwright/test').Page, name: string | RegExp) =>
  page.getByRole('heading', { level: 1, name });

// Each test signs in for its own session (support/session.ts).
const as = (key: AccountKey) => test.use({ account: key });

test.describe('patient portal', () => {
  as('patient-a');
  test('dashboard shows the summary tiles from real data', async ({ page }) => {
    await page.goto('/portal');
    for (const label of [
      'Upcoming visits',
      'Ready for pickup',
      'New lab reports',
      'Balance due',
      'Unread notifications',
    ])
      await expect(page.getByText(label, { exact: true })).toBeVisible();
  });
  test('payment history and notification centre open', async ({ page }) => {
    await page.goto('/portal/payments');
    await expect(heading(page, 'My payments')).toBeVisible();
    await page.goto('/portal/notifications');
    await expect(heading(page, 'Notifications')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark all as read' })).toBeVisible();
  });
  test('the header bell links to the notification centre', async ({ page }) => {
    await page.goto('/portal');
    await page
      .getByRole('link', { name: /^Notifications/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/portal\/notifications/);
  });
  test('staff analytics is not available to a patient', async ({ page }) => {
    await page.goto('/dashboard/analytics');
    await expect(heading(page, 'Analytics')).toHaveCount(0);
  });
});

test.describe('accountant', () => {
  as('accountant-a');
  test('accounts, reconciliation and claims open', async ({ page }) => {
    await page.goto('/dashboard/billing');
    await expect(heading(page, 'Accounts')).toBeVisible();
    await expect(page.getByText('Collected today')).toBeVisible();
    await page.goto('/dashboard/payments/reconciliation');
    await expect(heading(page, 'Reconciliation')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
    await page.goto('/dashboard/billing/claims');
    await expect(heading(page, 'Insurance claims')).toBeVisible();
  });
  test('analytics is for hospital admins only', async ({ page }) => {
    await page.goto('/dashboard/analytics');
    await expect(page.getByText('You do not have access to this page')).toBeVisible();
  });
});

test.describe('hospital admin', () => {
  as('hospital-admin-a');
  test('analytics overview and operations load with a date range', async ({ page }) => {
    await page.goto('/dashboard/analytics');
    await expect(heading(page, 'Analytics')).toBeVisible();
    await expect(page.getByText('Active doctors')).toBeVisible();
    await page.getByRole('button', { name: 'Last 7 days' }).click();
    await page.getByRole('tab', { name: 'Operations' }).click();
    await expect(page.getByText('Median turnaround')).toBeVisible();
  });
});

test.describe('global search', () => {
  as('receptionist-a');
  test('search from the header shows results or a clear empty state', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'the header search box is shown from tablet width up');
    await page.goto('/dashboard');
    const box = page.getByRole('search').getByRole('textbox');
    await box.fill('e2e');
    await box.press('Enter');
    await expect(page).toHaveURL(/\/dashboard\/search\?q=e2e/);
    await expect(heading(page, 'Search')).toBeVisible();
    await expect(page.getByText(/No results for|Patients|Doctors/).first()).toBeVisible();
  });
});
