import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests (PRD journeys: registration, book appointment, pay invoice, download report).
 *
 * Runs only against the isolated E2E stack (DEC-061): web on 3100 and API on 3101, connected to the
 * disposable medcore_e2e database and Redis database 1. Your development stack (3000/3001, your
 * development database) is never used. Prepare the database once with `pnpm e2e:db:prepare`;
 * Playwright starts the two servers itself (or reuses them if already running).
 * Browsers are installed separately with: pnpm --filter @medcore/e2e exec playwright install
 */
const WEB = 'http://localhost:3100';

export default defineConfig({
  testDir: './tests',
  // Checks the stack, confirms it is the E2E stack, and signs in each seeded role once.
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'node ../scripts/e2e/run.mjs api',
      url: 'http://localhost:3101/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: 'node ../scripts/e2e/run.mjs web',
      url: WEB,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
});
