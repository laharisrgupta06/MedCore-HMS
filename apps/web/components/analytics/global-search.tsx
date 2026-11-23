'use client';

import type { SearchKind } from '@medcore/types';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { PageHeader } from '@/components/app/app-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Panel, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/forms';
import { analyticsApi } from '@/services/analytics';
import { Segmented } from '@/components/ui/segmented';

const LABEL: Record<SearchKind, string> = {
  patients: 'Patients',
  doctors: 'Doctors',
  appointments: 'Appointments',
  invoices: 'Invoices',
  prescriptions: 'Prescriptions',
  medicines: 'Medicines',
};

/** Header search box for staff: submits to the search page. */
export function HeaderSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  return (
    <form
      role="search"
      className="hidden md:block"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (q.trim().length >= 2)
          router.push(`/dashboard/search?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <label className="relative block">
        <span className="sr-only">Search patients, doctors, appointments and more</span>
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
          aria-hidden="true"
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search"
          className="h-9 w-48 pl-8 lg:w-56"
        />
      </label>
    </form>
  );
}

/** Global search results (DASH-012), grouped by kind; only kinds this role may open are searched. */
export function GlobalSearch() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = params.get('q') ?? '';
  const [text, setText] = useState(initial);
  const [kind, setKind] = useState<SearchKind | null>(null);
  // A new search in the URL (header box, back button) refills the box; adjusted during render.
  const [shown, setShown] = useState(initial);
  if (shown !== initial) {
    setShown(initial);
    setText(initial);
  }
  const q = initial.trim();
  // The unfiltered search gives the kinds this role may filter by; a filtered one narrows the view.
  const all = useQuery({
    queryKey: ['search', q, null],
    queryFn: () => analyticsApi.search(q),
    enabled: q.length >= 2,
  });
  const filtered = useQuery({
    queryKey: ['search', q, kind],
    queryFn: () => analyticsApi.search(q, kind ? [kind] : undefined),
    enabled: q.length >= 2 && kind !== null,
  });
  const res = kind ? filtered : all;
  const kinds = all.data?.searched ?? [];
  return (
    <>
      <PageHeader
        title="Search"
        description="Results are limited to this hospital and to records your role can open."
      />
      <form
        role="search"
        className="mb-6 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          router.replace(`/dashboard/search?q=${encodeURIComponent(text.trim())}`);
        }}
      >
        <label className="flex-1">
          <span className="sr-only">Search</span>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Name, MRN, invoice number, medicine…"
            autoFocus
          />
        </label>
        <Button type="submit" disabled={text.trim().length < 2}>
          Search
        </Button>
      </form>
      {q.length < 2 ? (
        <p className="text-body-sm text-ink-muted">Type at least 2 characters.</p>
      ) : res.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : res.error ? (
        <Alert tone="error" title="Search failed">
          {errorMessage(res.error)}
        </Alert>
      ) : (
        <>
          {kinds.length > 1 && (
            <Segmented
              className="mb-4"
              label="Filter results"
              as="radio"
              value={kind ?? 'all'}
              options={[
                { value: 'all', label: 'All' },
                ...kinds.map((k) => ({ value: k, label: LABEL[k] })),
              ]}
              onChange={(v) => setKind(v === 'all' ? null : (v as SearchKind))}
            />
          )}
          {res.data.groups.every((g) => g.hits.length === 0) ? (
            <p className="text-body-sm text-ink-muted">No results for “{res.data.query}”.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {res.data.groups
                .filter((g) => g.hits.length > 0)
                .map((g) => (
                  <Panel key={g.kind} title={LABEL[g.kind]}>
                    <ul className="divide-y divide-border">
                      {g.hits.map((h) => (
                        <li key={h.id}>
                          <Link href={h.href} className="flex flex-col px-5 py-3 hover:bg-sage-50">
                            <span className="font-medium">{h.title}</span>
                            <span className="text-caption text-ink-muted">{h.subtitle}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {g.more && (
                      <p className="px-5 py-2 text-caption text-ink-muted">
                        Showing the first {g.hits.length}.{' '}
                        {kind
                          ? 'Refine the search to narrow it down.'
                          : 'Filter by this kind or refine the search.'}
                      </p>
                    )}
                  </Panel>
                ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
