// Starts one part of the isolated E2E stack (DEC-061) with the E2E environment:
//   node scripts/e2e/run.mjs api   NestJS API on port 3101
//   node scripts/e2e/run.mjs web   Next.js on port 3100 (build folder .next-e2e)
// Used by the Playwright webServer configuration; it can also be run by hand.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { E2E_WEB_PORT, ROOT, e2eEnv } from './env.mjs';

const env = { ...process.env, ...e2eEnv() };
const part = process.argv[2];
const spec =
  part === 'api'
    ? { cwd: resolve(ROOT, 'apps/api'), args: ['exec', 'nest', 'start'] }
    : part === 'web'
      ? {
          cwd: resolve(ROOT, 'apps/web'),
          args: ['exec', 'next', 'dev', '-p', String(E2E_WEB_PORT)],
        }
      : null;
if (!spec) {
  console.error('Usage: node scripts/e2e/run.mjs api | web');
  process.exit(2);
}
const child = spawn('pnpm', spec.args, { cwd: spec.cwd, env, stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
