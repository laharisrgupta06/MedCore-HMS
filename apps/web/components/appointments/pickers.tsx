'use client';

import type { Doctor, PatientSummary } from '@medcore/types';
import { useQuery } from '@tanstack/react-query';
import { Check, Search } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { SearchInput } from '@/components/ui/search-input';
import { errorMessage } from '@/lib/forms';
import { cn } from '@/lib/utils';
import { doctorsApi, patientsApi } from '@/services/org';

function Picker<T extends { id: string }>({
  label,
  queryKey,
  fetcher,
  render,
  selected,
  onSelect,
  placeholder,
}: {
  label: string;
  queryKey: string;
  fetcher: (search: string) => Promise<{ items: T[] }>;
  render: (row: T) => { title: string; detail: string };
  selected: T | null;
  onSelect: (row: T | null) => void;
  placeholder: string;
}) {
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: [queryKey, 'pick', search],
    queryFn: () => fetcher(search),
    enabled: !selected,
  });
  if (selected) {
    const r = render(selected);
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-sage-200 bg-sage-50 px-3 py-2">
        <div>
          <p className="font-medium">{r.title}</p>
          <p className="text-body-sm text-ink-secondary">{r.detail}</p>
        </div>
        <Button variant="link" onClick={() => onSelect(null)}>
          Change<span className="sr-only"> {label.toLowerCase()}</span>
        </Button>
      </div>
    );
  }
  return (
    <div>
      <SearchInput
        label={`Search ${label.toLowerCase()}`}
        placeholder={placeholder}
        onSearch={setSearch}
      />
      <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-border">
        {q.error ? (
          <p className="p-3 text-body-sm text-error">{errorMessage(q.error)}</p>
        ) : q.isPending ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : q.data.items.length === 0 ? (
          <p className="flex items-center gap-2 p-3 text-body-sm text-ink-secondary">
            <Search className="size-4" aria-hidden="true" />
            No matches. Try another name.
          </p>
        ) : (
          <ul aria-label={`${label} results`}>
            {q.data.items.map((row) => {
              const r = render(row);
              return (
                <li key={row.id} className="border-b border-border last:border-0">
                  <button
                    type="button"
                    onClick={() => onSelect(row)}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-sage-50 max-sm:py-3',
                    )}
                  >
                    <span>
                      <span className="block font-medium">{r.title}</span>
                      <span className="block text-body-sm text-ink-secondary">{r.detail}</span>
                    </span>
                    <Check className="size-4 text-transparent" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export function DoctorPicker({
  selected,
  onSelect,
}: {
  selected: Doctor | null;
  onSelect: (d: Doctor | null) => void;
}) {
  return (
    <Picker<Doctor>
      label="Doctor"
      queryKey="doctors"
      placeholder="Name or specialisation"
      fetcher={(search) => doctorsApi.list({ limit: 8, ...(search ? { search } : {}) })}
      render={(d) => ({
        title: `Dr ${d.firstName} ${d.lastName}`,
        detail: [d.specialisation, ...d.departments.map((x) => x.name)].join(' · '),
      })}
      selected={selected}
      onSelect={onSelect}
    />
  );
}

export function PatientPicker({
  selected,
  onSelect,
}: {
  selected: PatientSummary | null;
  onSelect: (p: PatientSummary | null) => void;
}) {
  return (
    <Picker<PatientSummary>
      label="Patient"
      queryKey="patients"
      placeholder="Name, MRN, email or phone"
      fetcher={(search) => patientsApi.list({ limit: 8, ...(search ? { search } : {}) })}
      render={(p) => ({
        title: `${p.firstName} ${p.lastName}`,
        detail: [p.mrn, p.phone ?? p.email].join(' · '),
      })}
      selected={selected}
      onSelect={onSelect}
    />
  );
}
