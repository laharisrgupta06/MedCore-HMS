import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import type { AuthPrincipal } from '../auth/decorators';

/** Per-request tenant context (TEN-003). Filled by TenantGuard from the verified access token only. */
export interface TenantStore {
  principal?: AuthPrincipal;
  /** Set when a Super Admin used the cross-tenant client during this request (TEN-004). */
  crossTenantAccess?: boolean;
}

const storage = new AsyncLocalStorage<TenantStore>();

export const TenantContext = {
  /** Runs fn with a fresh, empty store. Used by the request middleware and by tests and jobs. */
  run<T>(fn: () => T, store: TenantStore = {}): T {
    return storage.run(store, fn);
  },
  store(): TenantStore | undefined {
    return storage.getStore();
  },
  principal(): AuthPrincipal | undefined {
    return storage.getStore()?.principal;
  },
  setPrincipal(p: AuthPrincipal): void {
    const s = storage.getStore();
    if (!s) throw new Error('TenantContext.setPrincipal called outside a request context');
    s.principal = p;
  },
};

/** Express middleware: every request gets its own store before guards run. */
export function tenantContextMiddleware(_req: Request, _res: Response, next: NextFunction): void {
  storage.run({}, next);
}
