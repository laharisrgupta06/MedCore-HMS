'use client';

import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Input } from './field';

/** Debounced search box (300 ms) with an accessible label. */
export function SearchInput({
  label,
  onSearch,
  placeholder,
}: {
  label: string;
  onSearch: (v: string) => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState('');
  useEffect(() => {
    const t = setTimeout(() => onSearch(value.trim()), 300);
    return () => clearTimeout(t);
  }, [value, onSearch]);
  return (
    <div className="relative w-full sm:w-72">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
        aria-hidden="true"
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="pl-9"
      />
    </div>
  );
}
