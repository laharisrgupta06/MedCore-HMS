import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests (PRD journeys: registration, book appointment, pay invoice,
 * download report). Specs are added from Phase 1. Run with: pnpm --filter @medcore/e2e test:e2e
 * Browsers are installed separately with: pnpm --filter @medcore/e2e exec playwright install
 */
export default defineConfig({
  testDir: './tests',
  // Stops the run with a clear message when the web app or the API is not running.
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
});
