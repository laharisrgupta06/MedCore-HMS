import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type FullConfig } from '@playwright/test';
import { signedInState } from './support/session';

/**
 * 1. Fails fast when the stack is not running (statuses only, never bodies or secrets).
 * 2. Signs in once through the real sign-in page, which proves the stack is the E2E stack, and
 *    passes the password on to the tests, which sign in for their own sessions.
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

  // scripts/e2e/env.mjs is an ES module (it uses import.meta); Playwright compiles this file as
  // CommonJS, so the module is loaded with a native dynamic import at run time.
  const { e2eEnv } = (await import(
    pathToFileURL(resolve(__dirname, '../scripts/e2e/env.mjs')).href
  )) as { e2eEnv: () => Record<string, string | undefined> };
  const password = e2eEnv().E2E_PASSWORD;
  if (!password) throw new Error('E2E_PASSWORD is not set in the repository-root .env.');

  // Tests sign in for their own sessions (support/session.ts); they read the password from here.
  process.env.E2E_PASSWORD = password;
  // One sign-in through the real page proves the stack is the E2E stack: the seeded accounts
  // exist only in medcore_e2e.
  const browser = await chromium.launch();
  try {
    await signedInState(browser, 'super-admin', base);
  } catch {
    throw new Error(
      'Could not sign in as super-admin. Either the stack is not using medcore_e2e or the seed is missing: run `pnpm e2e:db:prepare`.',
    );
  } finally {
    await browser.close();
  }
}
