'use client';

import type { MeResponse, SessionResponse } from '@medcore/types';
import { create } from 'zustand';
import { ApiClientError, registerAuthHandlers } from '@/lib/api-client';
import { authApi } from '@/services/auth';

export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  me: MeResponse | null;
  /** Kept in memory only (never localStorage), per SECURITY.md. */
  accessToken: string | null;
  expiresAt: number | null;
  /** Set when a session ended without the user signing out (shown on the sign-in page). */
  expired: boolean;
  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<MeResponse>;
  logout: (allDevices?: boolean) => Promise<void>;
  refresh: () => Promise<boolean>;
  updateMe: (me: MeResponse) => void;
  sessionExpired: () => void;
}

const REFRESH_MARGIN_MS = 60_000;

/**
 * Refresh tokens rotate and a replayed token signs the user out everywhere (SEC-004). Two tabs
 * refreshing at the same moment would replay the same cookie, so refreshes are serialised across
 * tabs with the Web Locks API; each tab then presents the latest cookie.
 */
function withCrossTabLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? (locks.request('medcore-auth-refresh', fn) as unknown as Promise<T>) : fn();
}
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let inflight: Promise<boolean> | null = null;
const channel =
  typeof window !== 'undefined' && 'BroadcastChannel' in window
    ? new BroadcastChannel('medcore-auth')
    : null;

export const useAuth = create<AuthState>((set, get) => {
  const apply = (s: SessionResponse) => {
    const expiresAt = Date.now() + s.expiresIn * 1000;
    set({
      status: 'authenticated',
      me: { user: s.user, hospital: s.hospital, permissions: s.permissions },
      accessToken: s.accessToken,
      expiresAt,
      expired: false,
    });
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(
      () => void get().refresh(),
      Math.max(5_000, expiresAt - Date.now() - REFRESH_MARGIN_MS),
    );
  };
  const clear = (expired: boolean) => {
    clearTimeout(refreshTimer);
    set({ status: 'unauthenticated', me: null, accessToken: null, expiresAt: null, expired });
  };

  return {
    status: 'idle',
    me: null,
    accessToken: null,
    expiresAt: null,
    expired: false,

    /** Restores the session on page load from the httpOnly refresh cookie (silent refresh). */
    init: async () => {
      if (get().status !== 'idle') return;
      set({ status: 'loading' });
      const ok = await get().refresh();
      if (!ok) clear(false);
    },

    login: async (email, password) => {
      const s = await authApi.login(email, password);
      apply(s);
      channel?.postMessage('login');
      return { user: s.user, hospital: s.hospital, permissions: s.permissions };
    },

    /** One refresh at a time; concurrent callers share the result. */
    refresh: () => {
      inflight ??= withCrossTabLock(() => authApi.refresh())
        .then((s) => {
          apply(s);
          return true;
        })
        .catch((e: unknown) => {
          // A network failure is not a sign-out: keep the current state and let the caller retry.
          if (e instanceof ApiClientError && e.status === 0)
            return get().status === 'authenticated';
          if (get().status === 'authenticated') clear(true);
          return false;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },

    logout: async (allDevices = false) => {
      try {
        await authApi.logout(allDevices);
      } finally {
        clear(false);
        channel?.postMessage('logout');
      }
    },

    updateMe: (me) => set({ me }),
    sessionExpired: () => clear(true),
  };
});

registerAuthHandlers({
  getAccessToken: () => useAuth.getState().accessToken,
  refresh: () => useAuth.getState().refresh(),
  onSessionExpired: () => useAuth.getState().sessionExpired(),
});

// Signing out in one tab signs out the others; signing in elsewhere restores the session here.
channel?.addEventListener('message', (e: MessageEvent<string>) => {
  if (e.data === 'logout') {
    clearTimeout(refreshTimer);
    useAuth.setState({ status: 'unauthenticated', me: null, accessToken: null, expiresAt: null });
  } else if (e.data === 'login' && useAuth.getState().status !== 'authenticated') {
    void useAuth.getState().refresh();
  }
});
