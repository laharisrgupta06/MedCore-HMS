'use client';

import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { notificationsApi } from '@/services/notifications';
import { UNREAD_KEY, useNotificationStream } from './notification-stream';

/** Header bell with the unread count; opens the notification centre. */
export function NotificationBell({ href }: { href: string }) {
  useNotificationStream();
  const q = useQuery({
    queryKey: UNREAD_KEY,
    queryFn: () => notificationsApi.unreadCount(),
    // Fallback when the live connection is down.
    refetchInterval: 60_000,
  });
  const n = q.data?.unread ?? 0;
  return (
    <Link
      href={href}
      className="relative rounded-sm p-2 text-ink-secondary hover:text-ink"
      aria-label={n > 0 ? `Notifications, ${n} unread` : 'Notifications'}
    >
      <Bell className="size-5" aria-hidden="true" />
      {n > 0 && (
        <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-tomato-600 px-1 text-center text-[10px] font-semibold leading-4 text-white">
          {n > 99 ? '99+' : n}
        </span>
      )}
    </Link>
  );
}
