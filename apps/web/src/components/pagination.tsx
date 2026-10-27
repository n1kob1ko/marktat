import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@marktat/ui';

/** Seitennavigation für Listen (Suche, Admin-Bereich). `hrefFor` baut den Link zu einer Seite. */
export function Pagination({ page, totalPages, hrefFor }: { page: number; totalPages: number; hrefFor: (page: number) => string }) {
  if (totalPages <= 1) return null;
  const pages = new Set([1, totalPages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= totalPages));
  const sorted = [...pages].sort((a, b) => a - b);
  const item = 'flex h-10 min-w-10 items-center justify-center rounded-xl px-3 text-sm font-semibold transition-colors';
  return (
    <nav aria-label="Seiten" className="mt-8 flex flex-wrap items-center justify-center gap-1.5">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className={cn(item, 'border border-line bg-surface text-ink-800 hover:border-brand-300')} rel="prev">
          <ChevronLeft className="size-4" aria-hidden="true" />
          <span className="sr-only sm:not-sr-only sm:ml-1">Zurück</span>
        </Link>
      ) : null}
      {sorted.map((p, i) => (
        <span key={p} className="flex items-center gap-1.5">
          {i > 0 && p - sorted[i - 1]! > 1 ? <span className="px-1 text-ink-400" aria-hidden="true">…</span> : null}
          {p === page ? (
            <span aria-current="page" className={cn(item, 'bg-brand-700 text-white')}>
              {p}
            </span>
          ) : (
            <Link href={hrefFor(p)} className={cn(item, 'border border-line bg-surface text-ink-800 hover:border-brand-300')} aria-label={`Seite ${p}`}>
              {p}
            </Link>
          )}
        </span>
      ))}
      {page < totalPages ? (
        <Link href={hrefFor(page + 1)} className={cn(item, 'border border-line bg-surface text-ink-800 hover:border-brand-300')} rel="next">
          <span className="sr-only sm:not-sr-only sm:mr-1">Weiter</span>
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      ) : null}
    </nav>
  );
}

