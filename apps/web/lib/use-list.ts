'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { Page } from './api-client';
import { errorMessage } from './forms';

/** Paginated, searchable list state backed by TanStack Query. */
export type ListQuery = Record<string, string | number | undefined>;

export function useList<T>(
  key: string,
  fetcher: (q: ListQuery) => Promise<Page<T>>,
  filters: Record<string, string | undefined> = {},
) {
  const [page, setPage] = useState(1);
  const [search, setSearchRaw] = useState('');
  const setSearch = useCallback((v: string) => {
    setSearchRaw(v);
    setPage(1);
  }, []);
  const query = useQuery({
    queryKey: [key, page, search, filters],
    queryFn: () => fetcher({ page, ...(search ? { search } : {}), ...filters }),
    placeholderData: keepPreviousData,
  });
  return {
    rows: query.data?.items,
    meta: query.data?.meta,
    loading: query.isPending,
    error: query.error ? errorMessage(query.error) : null,
    refetch: () => void query.refetch(),
    setPage,
    setSearch,
  };
}
