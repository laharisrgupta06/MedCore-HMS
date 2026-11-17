import type { FullConfig } from '@playwright/test';

/**
 * Fails fast when the stack is not running, instead of letting API-dependent tests fail later on
 * missing text. Checks the web app and, through its same-origin proxy, the API health route
 * (the path a browser uses). Prints statuses only, never response bodies or secrets.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const base = config.projects[0]?.use.baseURL ?? 'http://localhost:3000';
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
        'The application stack is not ready, so the end-to-end tests were not run.',
        `  web ${base}: ${web}`,
        `  api ${base}/api/health (through the web proxy): ${api}`,
        'Start it with `pnpm infra:up` and `pnpm dev`, and check the API terminal output for a startup error.',
      ].join('\n'),
    );
}
