import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { ChevronRight, SearchX, X } from 'lucide-react';
import { Container, Skeleton, buttonClasses } from '@marktat/ui';
import {
  SEARCH_RADII,
  VERTICALS,
  VERTICAL_LABELS,
  VERTICAL_SLUGS,
  hasActiveFilters,
  isCategoryPath,
  parseSearchParams,
  peekFilterScope,
  searchFiltersFor,
  toSearchParams,
  type CategoryNode,
  type SearchQuery,
  type SearchResult,
  type SearchSort,
} from '@marktat/shared';
import { api } from '@/lib/api';
import { findCategory, getCategories } from '@/lib/data';
import { activeFilters, findCategoryByPath, resetHref, scopeLabel, searchHref } from '@/lib/search';
import { ListingCard } from '@/components/listing-card';
import { SearchFilters } from '@/components/search/search-filters';
import { SortSelect } from '@/components/search/sort-select';
import { SaveSearchButton } from '@/components/saved-search/save-search-button';
import { Pagination } from '@/components/pagination';

export const metadata: Metadata = {
  title: 'Anzeigen suchen',
  description: 'Kleinanzeigen in ganz Österreich durchsuchen – nach Kategorie, Preis, Ort, Umkreis und Eigenschaften filtern.',
};

type Params = Record<string, string | string[] | undefined>;

export default function SearchPage({ searchParams }: PageProps<'/suche'>) {
  return (
    <Container className="py-6 sm:py-10">
      <Suspense fallback={<SearchSkeleton />}>
        <SearchResults searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

async function SearchResults({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const categories = await getCategories();

  // Alte Links mit Kategorie-ID (…?kategorie=ck…) auf den sprechenden Pfad umleiten
  const rawCategory = [params.kategorie].flat()[0];
  if (rawCategory && !isCategoryPath(rawCategory)) {
    const legacy = findCategory(categories, rawCategory);
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (typeof value === 'string' && key !== 'kategorie') next.set(key, value);
    if (legacy) next.set('kategorie', legacy.path);
    redirect(`/suche${next.size ? `?${next}` : ''}`);
  }

  // Ungültige oder unbekannte Werte werden still ignoriert – die Seite zeigt dann ohne diesen Filter an
  const scope = peekFilterScope(params);
  const category = scope?.includes('/') ? findCategoryByPath(categories, scope) : undefined;
  const filters = searchFiltersFor(category ? category.path : scope?.includes('/') ? null : scope);
  const { query } = parseSearchParams(params, filters);
  if (query.category && !category) delete query.category;
  if (category) query.vertical = category.vertical;

  const apiParams = new URLSearchParams(searchHref(query, filters).split('?')[1] ?? '');
  apiParams.set('pageSize', String(query.pageSize));
  let result: SearchResult | null = null;
  try {
    result = await api<SearchResult>(`/listings?${apiParams}`, { cache: 'no-store' });
  } catch {
    result = null;
  }
  if (result && query.page > 1 && result.totalPages > 0 && query.page > result.totalPages) {
    redirect(searchHref({ ...query, page: result.totalPages }, filters));
  }

  const location = result?.location ?? null;
  const chips = activeFilters(query, filters, { category, location });
  const label = scopeLabel(query, category);
  const heading = query.q ? `Ergebnisse für „${query.q}“` : (label ?? 'Alle Anzeigen');
  const where = location ? ` in ${location.postalCode} ${location.place}${query.radiusKm ? ` + ${query.radiusKm} km` : ''}` : '';

  const sorts: SearchSort[] = [
    ...(query.q ? (['relevanz'] as const) : []),
    'neueste',
    'preis_auf',
    'preis_ab',
    ...(location ? (['entfernung'] as const) : []),
  ];
  const sortHrefs = Object.fromEntries(sorts.map((sort) => [sort, searchHref({ ...query, sort, page: 1 }, filters)]));
  const formKey = searchHref(query, filters);

  // „Suche speichern“: alle Filter außer Seite; Name und Beschreibung aus den aktiven Filtern
  const saveParams = toSearchParams(query, filters);
  delete saveParams.seite;
  delete saveParams.pageSize;
  const saveLabels = [...(query.q ? [`„${query.q}“`] : []), ...chips.map((chip) => chip.label)];
  const saveName = (saveLabels.join(' · ') || heading).replace(/[„“]/g, '').slice(0, 80);

  return (
    <div className="grid gap-5 lg:grid-cols-[18rem_1fr] lg:gap-8">
      <aside aria-label="Filter" className="lg:self-start">
        <SearchFilters key={formKey} query={query} categories={categories} location={location} activeCount={chips.length} total={result?.total ?? null} />
      </aside>

      <section aria-labelledby="results-heading" className="min-w-0">
        {category ? <Breadcrumb categories={categories} path={category.path} query={query} /> : null}
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h1 id="results-heading" className="text-2xl font-bold text-balance text-ink-950 sm:text-3xl">
              {heading}
              {where ? <span className="font-normal text-ink-600">{where}</span> : null}
            </h1>
            {result ? (
              <p className="mt-1 text-sm text-ink-500" aria-live="polite">
                {result.total.toLocaleString('de-AT')} {result.total === 1 ? 'Anzeige' : 'Anzeigen'}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasActiveFilters(query) ? (
              <SaveSearchButton params={saveParams} labels={saveLabels} defaultName={saveName} returnTo={searchHref({ ...query, page: 1 }, filters)} />
            ) : null}
            {result && result.total > 1 ? <SortSelect value={query.sort} options={sorts} hrefFor={sortHrefs} /> : null}
          </div>
        </div>

        {chips.length ? (
          <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="Aktive Filter">
            {chips.map((chip) => (
              <Link
                key={chip.id}
                href={chip.removeHref}
                scroll={false}
                className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 py-1 pr-2 pl-3 text-sm font-medium text-brand-900 transition-colors hover:border-brand-400 hover:bg-brand-100"
                aria-label={`Filter entfernen: ${chip.label}`}
              >
                {chip.label}
                <X className="size-3.5" aria-hidden="true" />
              </Link>
            ))}
            {chips.length > 1 ? (
              <Link href={resetHref(query)} className="px-2 text-sm font-semibold text-brand-700 hover:underline">
                Alle zurücksetzen
              </Link>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6">
          {!result ? (
            <p className="rounded-xl border border-line bg-surface p-6 text-ink-600" role="alert">
              Die Suche ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.
            </p>
          ) : result.items.length === 0 ? (
            <EmptyState query={query} filtersActive={chips.length > 0} hrefFor={(change) => searchHref({ ...query, ...change, page: 1 }, filters)} />
          ) : (
            <>
              {result.topAds.length ? <TopAds items={result.topAds} /> : null}
              <ul aria-label="Suchergebnisse" className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
                {result.items.map((listing) => (
                  <li key={listing.id} className="flex">
                    <ListingCard listing={listing} />
                  </li>
                ))}
              </ul>
              <Pagination page={query.page} totalPages={result.totalPages} hrefFor={(page) => searchHref({ ...query, page }, filters)} />
            </>
          )}
        </div>
      </section>
    </div>
  );
}

/** Top-Anzeigen über den Ergebnissen: nur passende, wechselnd; bezahlte tragen auf der Karte „Gesponsert“. */
function TopAds({ items }: { items: SearchResult['topAds'] }) {
  const paid = items.some((item) => item.sponsored);
  return (
    <section aria-labelledby="top-ads-heading" className="mb-6 rounded-[var(--radius-card)] border border-accent-100 bg-accent-50/40 p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
        <h2 id="top-ads-heading" className="font-sans text-base font-semibold tracking-normal text-ink-900">Top-Anzeigen</h2>
        <p className="text-xs text-ink-500">
          {paid ? 'Passend zu deiner Suche, abwechselnd angezeigt. Bezahlte Platzierungen sind gekennzeichnet.' : 'Passend zu deiner Suche, abwechselnd angezeigt – während der Einführungsphase kostenlos.'}
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
        {items.map((listing) => (
          <li key={listing.id} className="flex">
            <ListingCard listing={listing} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Breadcrumb({ categories, path, query }: { categories: CategoryNode[]; path: string; query: SearchQuery }) {
  const segments = path.split('/');
  const trail = segments
    .slice(1)
    .map((_, i) => findCategoryByPath(categories, segments.slice(0, i + 2).join('/')))
    .filter((c): c is CategoryNode => Boolean(c));
  const base: Record<string, string> = query.q ? { q: query.q } : {};
  const vertical = VERTICALS.find((v) => VERTICAL_SLUGS[v] === segments[0]);
  return (
    <nav aria-label="Kategorien" className="mb-2 flex flex-wrap items-center gap-1 text-sm text-ink-500">
      <Link href={`/suche?${new URLSearchParams({ ...base, bereich: segments[0]! })}`} className="hover:text-brand-700 hover:underline">
        {vertical ? VERTICAL_LABELS[vertical] : segments[0]}
      </Link>
      {trail.slice(0, -1).map((c) => (
        <span key={c.id} className="flex items-center gap-1">
          <ChevronRight className="size-3.5" aria-hidden="true" />
          <Link href={`/suche?${new URLSearchParams({ ...base, kategorie: c.path })}`} className="hover:text-brand-700 hover:underline">
            {c.name}
          </Link>
        </span>
      ))}
    </nav>
  );
}

function EmptyState({
  query,
  filtersActive,
  hrefFor,
}: {
  query: SearchQuery;
  filtersActive: boolean;
  hrefFor: (change: Partial<SearchQuery>) => string;
}) {
  const hasLocation = Boolean(query.locationId || query.postalCode);
  const nextRadius = hasLocation ? SEARCH_RADII.find((km) => km > (query.radiusKm ?? 0)) : undefined;
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-6 py-12 text-center sm:py-14">
      <SearchX className="mx-auto size-8 text-ink-300" aria-hidden="true" />
      <p className="mt-3 font-semibold text-ink-900">Keine passenden Anzeigen gefunden</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">
        {query.q
          ? 'Prüfe die Schreibweise oder versuche einen allgemeineren Suchbegriff.'
          : hasActiveFilters(query)
            ? 'Mit diesen Filtern gibt es gerade keine Anzeigen. Lockere die Filter oder schau später wieder vorbei.'
            : 'Hier gibt es noch keine Anzeigen.'}
        {hasLocation && !nextRadius ? ' Auch im größten Umkreis gibt es nichts – versuche es ohne Ort.' : ''}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {nextRadius ? (
          <Link href={hrefFor({ radiusKm: nextRadius })} className={buttonClasses({ variant: 'outline' })}>
            Umkreis auf {nextRadius} km erweitern
          </Link>
        ) : null}
        {filtersActive ? (
          <Link href={resetHref(query)} className={buttonClasses({ variant: hasLocation ? 'ghost' : 'outline' })}>
            Alle Filter zurücksetzen
          </Link>
        ) : null}
        <Link href="/inserieren" className={buttonClasses({ variant: 'ghost' })}>
          Selbst etwas inserieren
        </Link>
      </div>
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-[18rem_1fr] lg:gap-8">
      <Skeleton className="h-11 lg:h-[36rem]" />
      <div>
        <Skeleton className="mb-6 h-9 w-64" />
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      </div>
    </div>
  );
}
