import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type FullConfig } from '@playwright/test';
import { e2eEnv } from '../scripts/e2e/env.mjs';
import { ACCOUNTS, stateFile, type AccountKey } from './support/accounts';

/**
 * 1. Fails fast when the stack is not running (statuses only, never bodies or secrets).
 * 2. Signs in each seeded account once through the real sign-in page and saves its browser state
 *    to e2e/.auth/ (git-ignored), so tests start signed in. The first sign-in also proves the
 *    stack is the E2E stack: the seeded accounts exist only in medcore_e2e.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const base = config.projects[0]?.use.baseURL ?? 'http://localhost:3100';
  const get = async (url: string) => {
    try {
      return (await fetch(url, { signal: AbortSignal.timeout(10_000) })).status;
    } catch (e) {
      return `unreachable (${(e as Error).message})`;
    }
  };
  const web = await get(base);
  const api = await get(new URL('/api/health', base).toString());
  if (web !== 200 || api !== 200)
    throw new Error(
      [
        'The E2E stack is not ready, so the end-to-end tests were not run.',
        `  web ${base}: ${web}`,
        `  api ${base}/api/health (through the web proxy): ${api}`,
        'Check `pnpm infra:up`, then `pnpm e2e:db:prepare`, and the API output for a startup error.',
      ].join('\n'),
    );

  const password = e2eEnv().E2E_PASSWORD;
  if (!password) throw new Error('E2E_PASSWORD is not set in the repository-root .env.');

  const dir = resolve(__dirname, '.auth');
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const key of Object.keys(ACCOUNTS) as AccountKey[]) {
      const { email, home } = ACCOUNTS[key];
      const context = await browser.newContext({ baseURL: base });
      const page = await context.newPage();
      await page.goto('/login');
      await page.getByLabel(/^Email/).fill(email);
      await page.getByLabel(/^Password/).fill(password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      try {
        await page.waitForURL(home, { timeout: 20_000 });
      } catch {
        throw new Error(
          `Could not sign in as ${key}. Either the stack is not using medcore_e2e or the seed is missing: run \`pnpm e2e:db:prepare\`.`,
        );
      }
      await context.storageState({ path: stateFile(key) });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
