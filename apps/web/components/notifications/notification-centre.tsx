'use client';

import type { NotificationView } from '@medcore/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/app/app-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge, Panel, Skeleton } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/forms';
import { notificationsApi } from '@/services/notifications';
import { notificationHref } from './notification-links';
import { LIST_KEY, UNREAD_KEY } from './notification-stream';
import { Segmented } from '@/components/ui/segmented';

const LIMIT = 20;

/** Notification centre for staff and patients: the signed-in user's own notifications. */
export function NotificationCentre({ portal }: { portal: boolean }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [unread, setUnread] = useState(false);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: [...LIST_KEY, unread, page],
    queryFn: () => notificationsApi.list({ unread, page, limit: LIMIT }),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: LIST_KEY });
    void qc.invalidateQueries({ queryKey: UNREAD_KEY });
  };

  const open = async (n: NotificationView) => {
    try {
      if (!n.readAt) await notificationsApi.markRead(n.id);
    } catch (e) {
      toast.error(errorMessage(e));
    }
    refresh();
    const href = notificationHref(n, portal);
    if (href) router.push(href);
  };

  const readAll = async () => {
    setBusy(true);
    try {
      const r = await notificationsApi.markAllRead();
      toast.success(r.marked ? `Marked ${r.marked} as read.` : 'Nothing unread.');
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Updates about your appointments, reports, bills and work."
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Show"
          as="radio"
          value={unread ? 'unread' : 'all'}
          options={[
            { value: 'all', label: 'All' },
            { value: 'unread', label: 'Unread' },
          ]}
          onChange={(v) => {
            setUnread(v === 'unread');
            setPage(1);
          }}
        />
        <Button size="compact" variant="secondary" loading={busy} onClick={() => void readAll()}>
          Mark all as read
        </Button>
      </div>
      {q.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : q.error ? (
        <Alert tone="error" title="Could not load notifications">
          {errorMessage(q.error)}
        </Alert>
      ) : q.data.items.length === 0 ? (
        <p className="text-body-sm text-ink-muted">
          {unread ? 'No unread notifications.' : 'No notifications yet.'}
        </p>
      ) : (
        <>
          <Panel>
            <ul className="divide-y divide-border">
              {q.data.items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => void open(n)}
                    className={`relative flex w-full flex-col gap-1 px-5 py-3 text-left transition-colors duration-150 hover:bg-sage-50 ${n.readAt ? '' : 'bg-sage-50/50 before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-full before:bg-tomato-600'}`}
                  >
                    <span className="flex items-center gap-2">
                      {!n.readAt && <Badge tone="warning">New</Badge>}
                      <span className={n.readAt ? 'font-medium' : 'font-semibold'}>{n.title}</span>
                    </span>
                    <span className="text-body-sm text-ink-secondary">{n.body}</span>
                    <span className="text-caption text-ink-muted">
                      {new Date(n.createdAt).toLocaleString('en-IN')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
          {q.data.meta.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-end gap-3 text-body-sm">
              <Button
                size="compact"
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <span>
                Page {page} of {q.data.meta.totalPages}
              </span>
              <Button
                size="compact"
                variant="secondary"
                disabled={page >= q.data.meta.totalPages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
