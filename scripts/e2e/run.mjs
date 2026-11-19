// Starts one part of the isolated E2E stack (DEC-061) with the E2E environment:
//   node scripts/e2e/run.mjs api   NestJS API on port 3101
//   node scripts/e2e/run.mjs web   Next.js on port 3100 (build folder .next-e2e)
// Used by the Playwright webServer configuration; it can also be run by hand.
//
// The server runs in its own process group, so stopping this script (Ctrl+C, or Playwright at the
// end of a run) stops pnpm, the Nest or Next CLI and the server itself, leaving nothing on the
// ports. While the API is starting it reports which dependency the health check finds down.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { E2E_API_PORT, E2E_WEB_PORT, ROOT, e2eEnv } from './env.mjs';

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

const child = spawn('pnpm', spec.args, { cwd: spec.cwd, env, stdio: 'inherit', detached: true });
let stopping = false;
const stopGroup = (sig) => {
  try {
    process.kill(-child.pid, sig); // the whole group: pnpm, the CLI and the server
  } catch {
    /* already gone */
  }
};
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    stopping = true;
    stopGroup('SIGTERM');
    // A server that ignores SIGTERM is killed after ten seconds.
    setTimeout(() => stopGroup('SIGKILL'), 10_000).unref();
  });
}
process.on('exit', () => stopGroup('SIGKILL'));
child.on('exit', (code, signal) => {
  if (!stopping)
    console.error(`E2E ${part} server stopped unexpectedly (${signal ?? `exit ${code}`}).`);
  process.exit(stopping ? 0 : (code ?? 1));
});

if (part === 'api') {
  // Statuses only (db, redis, queue: up or down), never response bodies with other data.
  let last = '';
  const started = Date.now();
  const timer = setInterval(async () => {
    try {
      const r = await fetch(`http://localhost:${E2E_API_PORT}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) return clearInterval(timer);
      const d = (await r.json().catch(() => ({})))?.error?.details ?? {};
      const now = `db ${d.db ?? '?'}, redis ${d.redis ?? '?'}, queue ${d.queue ?? '?'}`;
      if (now !== last)
        console.error(`E2E API health ${r.status}: ${now}. Run pnpm e2e:check for the fix.`);
      last = now;
    } catch {
      /* not listening yet */
    }
    if (Date.now() - started > 180_000) clearInterval(timer);
  }, 5000);
  timer.unref();
}
