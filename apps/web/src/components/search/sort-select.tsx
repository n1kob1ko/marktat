'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Select } from '@marktat/ui';
import { SEARCH_SORT_LABELS, type SearchSort } from '@marktat/shared';

/** Sortierung; wechselt sofort die URL (ohne JavaScript: Formular mit Knopf). `labels` für andere Bereiche (z. B. Deals). */
export function SortSelect<T extends string = SearchSort>({
  value,
  options,
  hrefFor,
  labels = SEARCH_SORT_LABELS as Record<string, string>,
}: {
  value: T;
  options: T[];
  hrefFor: Record<string, string>;
  labels?: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="sortierung" className="text-sm whitespace-nowrap text-ink-600">
        Sortieren
      </label>
      <Select
        id="sortierung"
        value={value}
        aria-busy={pending}
        onChange={(e) => startTransition(() => router.push(hrefFor[e.target.value]!, { scroll: false }))}
        className="h-10 w-auto min-w-44 text-sm"
      >
        {options.map((sort) => (
          <option key={sort} value={sort}>
            {labels[sort]}
          </option>
        ))}
      </Select>
    </div>
  );
}
