'use client';

import {
  NOTIFICATION_SOCKET_EVENTS,
  type NotificationView,
  type UnreadCountView,
} from '@medcore/types';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { toast } from '@/components/ui/toast';
import { useAuth } from '@/store/auth';

export const UNREAD_KEY = ['notifications-unread'] as const;
export const LIST_KEY = ['notifications'] as const;

/**
 * Live notification pushes over Socket.IO (DEC-062).
 *
 * - Transport: HTTP long-polling through the same-origin /api proxy (the Next.js rewrite), with no
 *   trailing slash on the path so the proxy forwards it unchanged. No separate public API URL.
 * - Auth: the in-memory access token goes only in the handshake `auth` payload (never the URL).
 *   It is read fresh on every connect and reconnect.
 * - Token refresh: when the auth store gets a new access token the socket reconnects with it, before
 *   the server closes the old one at expiry. On sign-out it disconnects.
 * - If the server rejects or closes the socket, it retries with backoff while the user is signed in.
 * - If the socket is down, the unread count still refreshes by polling (NotificationBell).
 */
export function useNotificationStream(): void {
  const status = useAuth((s) => s.status);
  const qc = useQueryClient();

  useEffect(() => {
    if (status !== 'authenticated') return;
    const socket: Socket = io({
      path: '/api/socket.io',
      addTrailingSlash: false,
      transports: ['polling'],
      upgrade: false,
      auth: (cb) => cb({ token: useAuth.getState().accessToken ?? '' }),
      reconnectionDelay: 2_000,
      reconnectionDelayMax: 60_000,
    });
    let retry: ReturnType<typeof setTimeout> | undefined;
    let wait = 2_000;
    const later = () => {
      clearTimeout(retry);
      retry = setTimeout(() => {
        if (useAuth.getState().status === 'authenticated' && !socket.connected) socket.connect();
      }, wait);
      wait = Math.min(wait * 2, 60_000);
    };

    socket.on('connect', () => {
      wait = 2_000;
      void qc.invalidateQueries({ queryKey: UNREAD_KEY });
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    });
    // A rejected handshake (expired or revoked token) does not auto-retry; retry with the newest token.
    socket.on('connect_error', () => {
      if (!socket.active) later();
    });
    // The server closes the socket at token expiry or when the session is revoked.
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') later();
    });
    socket.on(NOTIFICATION_SOCKET_EVENTS.unread, (u: UnreadCountView) =>
      qc.setQueryData(UNREAD_KEY, u),
    );
    socket.on(NOTIFICATION_SOCKET_EVENTS.created, (n: NotificationView) => {
      void qc.invalidateQueries({ queryKey: LIST_KEY });
      // Something changed for this user: the patient dashboard summary is refreshed too.
      void qc.invalidateQueries({ queryKey: ['portal-summary'] });
      toast.success(n.title);
    });

    // Reconnect with the refreshed token as soon as the store has it.
    let token = useAuth.getState().accessToken;
    const unsubscribe = useAuth.subscribe((s) => {
      if (s.accessToken && s.accessToken !== token) {
        token = s.accessToken;
        wait = 2_000;
        socket.disconnect().connect();
      }
    });

    return () => {
      unsubscribe();
      clearTimeout(retry);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [status, qc]);
}
