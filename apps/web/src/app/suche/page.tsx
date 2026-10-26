import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { SearchX } from 'lucide-react';
import { Container, Select, Skeleton, buttonClasses } from '@marktat/ui';
import {
  STATES,
  VERTICAL_LABELS,
  VERTICAL_SLUGS,
  VERTICALS,
  type ListingSummary,
  type Paginated,
  type Vertical,
} from '@marktat/shared';
import { api } from '@/lib/api';
import { findCategory, getCategories } from '@/lib/data';
import { ListingCard } from '@/components/listing-card';

export const metadata: Metadata = {
  title: 'Anzeigen suchen',
  description: 'Kleinanzeigen in ganz Österreich durchsuchen – nach Kategorie und Bundesland filtern.',
};

const PAGE_SIZE = 24;

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default function SearchPage({ searchParams }: PageProps<'/suche'>) {
  return (
    <Container className="py-8 sm:py-10">
      <Suspense fallback={<SearchSkeleton />}>
        <SearchResults searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

async function SearchResults({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const q = one(params.q).slice(0, 100);
  const stateSlug = one(params.bundesland);
  const categoryId = one(params.kategorie);
  const vertical = (Object.entries(VERTICAL_SLUGS).find(([, slug]) => slug === one(params.bereich))?.[0] ?? '') as Vertical | '';
  const page = Math.max(1, Math.min(500, Number.parseInt(one(params.seite) || '1', 10) || 1));

  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (q) query.set('q', q);
  if (STATES.some((s) => s.slug === stateSlug)) query.set('state', stateSlug);
  if (categoryId) query.set('categoryId', categoryId);
  if (vertical) query.set('vertical', vertical);

  const [categories, result] = await Promise.all([
    getCategories(),
    api<Paginated<ListingSummary>>(`/listings?${query}`, { cache: 'no-store' }).catch(() => null),
  ]);
  const category = categoryId ? findCategory(categories, categoryId) : undefined;
  const topLevel = categories.filter((c) => !vertical || c.vertical === vertical);
  const heading = q ? `Ergebnisse für „${q}“` : (category?.name ?? (vertical ? VERTICAL_LABELS[vertical] : 'Alle Anzeigen'));
  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;

  const pageHref = (target: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (typeof value === 'string' && value) next.set(key, value);
    next.set('seite', String(target));
    return `/suche?${next}`;
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[17rem_1fr]">
      <aside aria-label="Filter">
        <form action="/suche" className="space-y-5 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="font-sans text-base font-semibold tracking-normal">Filter</h2>
          <div className="space-y-1.5">
            <label htmlFor="f-q" className="text-sm font-semibold">Suchbegriff</label>
            <input
              id="f-q"
              name="q"
              defaultValue={q}
              type="search"
              className="h-11 w-full rounded-xl border border-line-strong px-3.5 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/20 focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="f-bereich" className="text-sm font-semibold">Bereich</label>
            <Select id="f-bereich" name="bereich" defaultValue={vertical ? VERTICAL_SLUGS[vertical] : ''}>
              <option value="">Alle Bereiche</option>
              {VERTICALS.map((v) => (
                <option key={v} value={VERTICAL_SLUGS[v]}>{VERTICAL_LABELS[v]}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="f-kategorie" className="text-sm font-semibold">Kategorie</label>
            <Select id="f-kategorie" name="kategorie" defaultValue={categoryId}>
              <option value="">Alle Kategorien</option>
              {topLevel.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  <option value={c.id}>{c.name} – alle</option>
                  {c.children.map((child) => (
                    <option key={child.id} value={child.id}>{child.name}</option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="f-bundesland" className="text-sm font-semibold">Bundesland</label>
            <Select id="f-bundesland" name="bundesland" defaultValue={stateSlug}>
              <option value="">Ganz Österreich</option>
              {STATES.map((s) => (
                <option key={s.slug} value={s.slug}>{s.name}</option>
              ))}
            </Select>
          </div>
          <button type="submit" className={buttonClasses({ className: 'w-full' })}>Anzeigen filtern</button>
          <p className="text-xs leading-relaxed text-ink-500">Preisfilter, Umkreissuche und Spezialfilter folgen mit der Suche in Phase 2.</p>
        </form>
      </aside>

      <section aria-labelledby="results-heading">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
          <h1 id="results-heading" className="text-2xl font-bold text-ink-950 sm:text-3xl">{heading}</h1>
          {result ? (
            <p className="text-sm text-ink-500" aria-live="polite">
              {result.total.toLocaleString('de-AT')} {result.total === 1 ? 'Anzeige' : 'Anzeigen'}
            </p>
          ) : null}
        </div>

        {!result ? (
          <p className="rounded-xl border border-line bg-surface p-6 text-ink-600">Die Suche ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.</p>
        ) : result.items.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
            <SearchX className="mx-auto size-8 text-ink-300" aria-hidden="true" />
            <p className="mt-3 font-semibold text-ink-900">Keine passenden Anzeigen gefunden</p>
            <p className="mt-1 text-sm text-ink-500">Versuche einen anderen Suchbegriff oder entferne Filter.</p>
            <Link href="/suche" className={buttonClasses({ variant: 'outline', className: 'mt-5' })}>Filter zurücksetzen</Link>
          </div>
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
              {result.items.map((listing) => (
                <li key={listing.id} className="flex">
                  <ListingCard listing={listing} />
                </li>
              ))}
            </ul>
            {totalPages > 1 ? (
              <nav aria-label="Seiten" className="mt-8 flex items-center justify-center gap-2">
                {page > 1 ? <Link href={pageHref(page - 1)} className={buttonClasses({ variant: 'outline', size: 'sm' })}>Zurück</Link> : null}
                <span className="px-3 text-sm text-ink-600">Seite {page} von {totalPages}</span>
                {page < totalPages ? <Link href={pageHref(page + 1)} className={buttonClasses({ variant: 'outline', size: 'sm' })}>Weiter</Link> : null}
              </nav>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-[17rem_1fr]">
      <Skeleton className="h-96" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-72" />)}
      </div>
    </div>
  );
}
