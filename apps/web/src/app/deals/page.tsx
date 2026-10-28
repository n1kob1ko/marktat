import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { BadgeInfo, SearchX, Store, X } from 'lucide-react';
import { buttonClasses, Container, Skeleton } from '@marktat/ui';
import {
  DEAL_SORT_LABELS,
  dealCategoryBySlug,
  dealSearchHref,
  hasActiveDealFilters,
  toDealSearchParams,
  parseDealSearchParams,
  type DealSearchQuery,
  type DealSearchResult,
  type DealSort,
} from '@marktat/shared';
import { api } from '@/lib/api';
import { getDealCategories } from '@/lib/data';
import { dealChips } from '@/lib/deals';
import { DealCard } from '@/components/deals/deal-card';
import { DealFilters } from '@/components/deals/deal-filters';
import { SortSelect } from '@/components/search/sort-select';
import { Pagination } from '@/components/pagination';
import { SaveSearchButton } from '@/components/saved-search/save-search-button';

type Params = Record<string, string | string[] | undefined>;

const DESCRIPTION = 'Aktuelle Angebote und Aktionen österreichischer Händler – online und im Geschäft in deiner Nähe. Rabatte nur mit belegtem Vergleichspreis.';

/** Nur die Übersicht und reine Kategorieseiten werden indexiert; gefilterte Varianten nicht. */
export async function generateMetadata({ searchParams }: PageProps<'/deals'>): Promise<Metadata> {
  const params = await searchParams;
  const filters = Object.keys(params).filter((key) => params[key] !== undefined && key !== 'seite');
  const rawCategory = [params.kategorie].flat()[0];
  const category = rawCategory ? dealCategoryBySlug(rawCategory) : undefined;
  if (category && filters.length === 1) {
    return {
      title: `${category.name} – Deals & Angebote`,
      description: `${category.name}: aktuelle Angebote österreichischer Händler auf MarktAT.`,
      alternates: { canonical: `/deals?kategorie=${category.slug}` },
    };
  }
  if (!filters.length) return { title: 'Deals & Angebote', description: DESCRIPTION, alternates: { canonical: '/deals' } };
  return { title: 'Deals & Angebote', description: DESCRIPTION, robots: { index: false, follow: true }, alternates: { canonical: '/deals' } };
}

export default function DealsPage({ searchParams }: PageProps<'/deals'>) {
  return (
    <>
      <section className="border-b border-line bg-accent-50/60">
        <Container className="py-6 sm:py-8">
          <p className="text-sm font-semibold text-accent-700">Deals & Angebote</p>
          <h1 className="mt-1 text-2xl font-bold text-balance text-ink-950 sm:text-3xl">Aktuelle Angebote von Händlern</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-600">
            Zeitlich begrenzte Angebote gewerblicher Händler – getrennt von den Kleinanzeigen. Rabatte zeigen wir nur mit belegtem Vergleichspreis; jedes Angebot muss regelmäßig
            bestätigt werden.
          </p>
        </Container>
      </section>
      <Container className="py-6 sm:py-8">
        <Suspense fallback={<DealsSkeleton />}>
          <DealResults searchParams={searchParams} />
        </Suspense>
      </Container>
    </>
  );
}

async function DealResults({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  // Ungültige Werte werden ignoriert (die API würde mit 400 antworten)
  const { query, issues } = parseDealSearchParams(params);
  for (const issue of issues) {
    if (issue.param === 'kategorie') delete query.category;
    if (issue.param === 'haendler') delete query.merchantId;
  }
  const categories = await getDealCategories();
  const apiParams = new URLSearchParams(dealSearchHref(query).split('?')[1] ?? '');
  let result: DealSearchResult | null = null;
  try {
    result = await api<DealSearchResult>(`/deals?${apiParams}`, { cache: 'no-store' });
  } catch {
    result = null;
  }
  if (result && query.page > 1 && result.totalPages > 0 && query.page > result.totalPages) redirect(dealSearchHref({ ...query, page: result.totalPages }));

  const location = result?.location ?? null;
  const merchantName = query.merchantId ? result?.items[0]?.merchant.name : undefined;
  const chips = dealChips(query, location, merchantName);
  const category = query.category ? dealCategoryBySlug(query.category) : undefined;
  const heading = query.q ? `Angebote für „${query.q}“` : (category?.name ?? 'Alle Angebote');

  const sorts: DealSort[] = [...(query.q ? (['relevanz'] as const) : []), 'neueste', 'endet_bald', 'rabatt', 'preis_auf', 'preis_ab', ...(location ? (['entfernung'] as const) : [])];
  const sortHrefs = Object.fromEntries(sorts.map((sort) => [sort, dealSearchHref({ ...query, sort, page: 1 })]));
  const saveParams = toDealSearchParams({ ...query, page: 1 });
  delete saveParams.pageSize;
  const saveLabels = [...(query.q ? [`„${query.q}“`] : []), ...chips.map((chip) => chip.label)];
  const saveName = (saveLabels.join(' · ') || heading).replace(/[„“]/g, '').slice(0, 80);

  return (
    <div className="grid gap-5 lg:grid-cols-[18rem_1fr] lg:gap-8">
      <aside aria-label="Filter" className="lg:self-start">
        <DealFilters key={dealSearchHref(query)} query={query} categories={categories} location={location} activeCount={chips.length} total={result?.total ?? null} />
      </aside>

      <section aria-labelledby="deals-heading" className="min-w-0">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h2 id="deals-heading" className="text-xl font-bold text-ink-950 sm:text-2xl">{heading}</h2>
            {result ? (
              <p className="mt-1 text-sm text-ink-500" aria-live="polite">
                {result.total.toLocaleString('de-AT')} {result.total === 1 ? 'Angebot' : 'Angebote'}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasActiveDealFilters(query) ? (
              <SaveSearchButton kind="DEALS" params={saveParams} labels={saveLabels} defaultName={saveName} returnTo={dealSearchHref({ ...query, page: 1 })} />
            ) : null}
            {result && result.total > 1 ? <SortSelect value={query.sort} options={sorts} hrefFor={sortHrefs} labels={DEAL_SORT_LABELS} /> : null}
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
              <Link href={query.q ? `/deals?${new URLSearchParams({ q: query.q })}` : '/deals'} className="px-2 text-sm font-semibold text-brand-700 hover:underline">
                Alle zurücksetzen
              </Link>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6">
          {!result ? (
            <p className="rounded-xl border border-line bg-surface p-6 text-ink-600" role="alert">
              Die Angebote sind gerade nicht erreichbar. Bitte versuche es gleich noch einmal.
            </p>
          ) : result.items.length === 0 ? (
            <EmptyState query={query} />
          ) : (
            <>
              <ul aria-label="Angebote" className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
                {result.items.map((deal) => (
                  <li key={deal.id} className="flex">
                    <DealCard deal={deal} />
                  </li>
                ))}
              </ul>
              <Pagination page={query.page} totalPages={result.totalPages} hrefFor={(page) => dealSearchHref({ ...query, page })} />
            </>
          )}
        </div>

        <p className="mt-8 flex gap-2 text-xs leading-relaxed text-ink-500">
          <BadgeInfo className="size-4 shrink-0" aria-hidden="true" />
          Angebote stammen direkt von den Händlern, die sie hier eintragen. MarktAT verkauft nichts selbst und wickelt keine Zahlungen ab. Mit „Werbelink“ gekennzeichnete Links
          können dem Händler oder Dritten eine Provision einbringen.
        </p>
      </section>
    </div>
  );
}

function EmptyState({ query }: { query: DealSearchQuery }) {
  const filtered = hasActiveDealFilters(query);
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-6 py-12 text-center sm:py-14">
      {filtered ? <SearchX className="mx-auto size-8 text-ink-300" aria-hidden="true" /> : <Store className="mx-auto size-8 text-ink-300" aria-hidden="true" />}
      <p className="mt-3 font-semibold text-ink-900">{filtered ? 'Keine passenden Angebote gefunden' : 'Noch keine aktuellen Angebote'}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">
        {filtered
          ? 'Mit diesen Filtern gibt es gerade keine aktuellen Angebote. Lockere die Filter oder schau später wieder vorbei.'
          : 'Hier erscheinen Aktionen österreichischer Händler, sobald sie welche eintragen.'}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {filtered ? (
          <Link href="/deals" className={buttonClasses({ variant: 'outline' })}>
            Alle Filter zurücksetzen
          </Link>
        ) : null}
        <Link href="/konto/deals" className={buttonClasses({ variant: filtered ? 'ghost' : 'primary' })}>
          Als Händler Angebote eintragen
        </Link>
      </div>
    </div>
  );
}

function DealsSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-[18rem_1fr] lg:gap-8">
      <Skeleton className="h-11 lg:h-[32rem]" />
      <div>
        <Skeleton className="mb-6 h-9 w-64" />
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-80" />
          ))}
        </div>
      </div>
    </div>
  );
}
