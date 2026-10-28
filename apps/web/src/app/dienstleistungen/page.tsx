import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowRight, BadgeInfo, SearchX, UserRoundSearch, X } from 'lucide-react';
import { buttonClasses, Container, Skeleton } from '@marktat/ui';
import {
  SERVICE_CATEGORY_GROUPS,
  SERVICE_SORT_LABELS,
  hasActiveServiceFilters,
  parseServiceSearchParams,
  serviceCategoryBySlug,
  serviceGroupBySlug,
  serviceSearchHref,
  type ServiceSearchQuery,
  type ServiceSearchResult,
  type ServiceSort,
} from '@marktat/shared';
import { api } from '@/lib/api';
import { serviceChips } from '@/lib/services';
import { ServiceCard } from '@/components/services/service-card';
import { ServiceFilters } from '@/components/services/service-filters';
import { SortSelect } from '@/components/search/sort-select';
import { Pagination } from '@/components/pagination';

type Params = Record<string, string | string[] | undefined>;

const DESCRIPTION =
  'Freelancer, Handwerk, Nachhilfe und Dienstleister in Österreich finden und direkt über MarktAT anschreiben. Ohne Provision, ohne Vermittlungsgebühr.';

/** Nur die Übersicht sowie reine Bereichs- und Kategorieseiten werden indexiert; gefilterte Varianten nicht. */
export async function generateMetadata({ searchParams }: PageProps<'/dienstleistungen'>): Promise<Metadata> {
  const params = await searchParams;
  const filters = Object.keys(params).filter((key) => params[key] !== undefined && key !== 'seite');
  const rawCategory = [params.kategorie].flat()[0];
  const rawGroup = [params.bereich].flat()[0];
  const category = rawCategory ? serviceCategoryBySlug(rawCategory) : undefined;
  const group = !rawCategory && rawGroup ? serviceGroupBySlug(rawGroup) : undefined;
  if (category && filters.length === 1) {
    return { title: `${category.name} – Dienstleistungen`, description: `${category.name} in Österreich: Anbieter auf MarktAT finden und direkt anschreiben.`, alternates: { canonical: `/dienstleistungen?kategorie=${category.slug}` } };
  }
  if (group && filters.length === 1) {
    return { title: `${group.name} – Dienstleistungen`, description: `${group.name}: Anbieter in Österreich auf MarktAT finden.`, alternates: { canonical: `/dienstleistungen?bereich=${group.slug}` } };
  }
  if (!filters.length) return { title: 'Dienstleistungen & Freelancer', description: DESCRIPTION, alternates: { canonical: '/dienstleistungen' } };
  return { title: 'Dienstleistungen & Freelancer', description: DESCRIPTION, robots: { index: false, follow: true }, alternates: { canonical: '/dienstleistungen' } };
}

export default function ServicesPage({ searchParams }: PageProps<'/dienstleistungen'>) {
  return (
    <>
      <section className="border-b border-line bg-brand-50/60">
        <Container className="py-6 sm:py-8">
          <p className="text-sm font-semibold text-brand-700">Dienstleistungen</p>
          <h1 className="mt-1 text-2xl font-bold text-balance text-ink-950 sm:text-3xl">Anbieter und Freelancer finden</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-600">
            Profile von Menschen und Betrieben, die ihre Arbeit anbieten – von Webentwicklung bis Gartenpflege. Kontakt über die Nachrichten von MarktAT, ohne Provision. Es gibt
            keine Bewertungen; geprüft sind nur Qualifikationen mit dem Hinweis „von MarktAT geprüft“.
          </p>
          <p className="mt-3 text-sm">
            <Link href="/dienstleistungen/projekte" className="font-semibold text-brand-700 hover:underline">
              Du suchst jemanden für ein Vorhaben? Zu den Projektaufträgen
            </Link>
          </p>
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Bereiche">
            {SERVICE_CATEGORY_GROUPS.map((group) => (
              <li key={group.slug}>
                <Link
                  href={`/dienstleistungen?bereich=${group.slug}`}
                  className="inline-flex rounded-full border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink-800 hover:border-brand-400 hover:bg-brand-50"
                >
                  {group.name}
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </section>
      <Container className="py-6 sm:py-8">
        <Suspense fallback={<ServicesSkeleton />}>
          <ServiceResults searchParams={searchParams} />
        </Suspense>
      </Container>
    </>
  );
}

async function ServiceResults({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  // Ungültige Werte werden ignoriert (die API würde mit 400 antworten)
  const { query, issues } = parseServiceSearchParams(params);
  for (const issue of issues) {
    if (issue.param === 'kategorie') delete query.category;
    if (issue.param === 'bereich') delete query.group;
    if (issue.param === 'plz') delete query.postalCode;
    if (issue.param === 'preis_bis') delete query.priceMax;
  }
  const apiParams = new URLSearchParams(serviceSearchHref(query).split('?')[1] ?? '');
  let result: ServiceSearchResult | null = null;
  try {
    result = await api<ServiceSearchResult>(`/services?${apiParams}`, { cache: 'no-store' });
  } catch {
    result = null;
  }
  if (result && query.page > 1 && result.totalPages > 0 && query.page > result.totalPages) redirect(serviceSearchHref({ ...query, page: result.totalPages }));

  const location = result?.location ?? null;
  const chips = serviceChips(query, location);
  const category = query.category ? serviceCategoryBySlug(query.category) : undefined;
  const group = query.group ? serviceGroupBySlug(query.group) : undefined;
  const heading = query.q ? `Anbieter für „${query.q}“` : (category?.name ?? group?.name ?? 'Alle Anbieter');
  const related = category?.relatedCategoryPath ?? null;

  const sorts: ServiceSort[] = [...(query.q ? (['relevanz'] as const) : []), 'neueste', 'preis_auf', ...(location ? (['entfernung'] as const) : [])];
  const sortHrefs = Object.fromEntries(sorts.map((sort) => [sort, serviceSearchHref({ ...query, sort, page: 1 })]));

  return (
    <div className="grid gap-5 lg:grid-cols-[18rem_1fr] lg:gap-8">
      <aside aria-label="Filter" className="lg:self-start">
        <ServiceFilters key={serviceSearchHref(query)} query={query} location={location} activeCount={chips.length} total={result?.total ?? null} />
      </aside>

      <section aria-labelledby="services-heading" className="min-w-0">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h2 id="services-heading" className="text-xl font-bold text-ink-950 sm:text-2xl">{heading}</h2>
            {result ? (
              <p className="mt-1 text-sm text-ink-500" aria-live="polite">
                {result.total.toLocaleString('de-AT')} {result.total === 1 ? 'Anbieterprofil' : 'Anbieterprofile'}
              </p>
            ) : null}
          </div>
          {result && result.total > 1 ? <SortSelect value={query.sort} options={sorts} hrefFor={sortHrefs} labels={SERVICE_SORT_LABELS} /> : null}
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
              <Link href={query.q ? `/dienstleistungen?${new URLSearchParams({ q: query.q })}` : '/dienstleistungen'} className="px-2 text-sm font-semibold text-brand-700 hover:underline">
                Alle zurücksetzen
              </Link>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6">
          {!result ? (
            <p className="rounded-xl border border-line bg-surface p-6 text-ink-600" role="alert">
              Die Anbieter sind gerade nicht erreichbar. Bitte versuche es gleich noch einmal.
            </p>
          ) : result.items.length === 0 ? (
            <EmptyState query={query} />
          ) : (
            <>
              <ul aria-label="Anbieterprofile" className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
                {result.items.map((profile) => (
                  <li key={profile.id} className="flex">
                    <ServiceCard profile={profile} />
                  </li>
                ))}
              </ul>
              <Pagination page={query.page} totalPages={result.totalPages} hrefFor={(page) => serviceSearchHref({ ...query, page })} />
            </>
          )}
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Link href="/dienstleistungen/projekte" className="group rounded-xl border border-line bg-surface p-4 hover:border-brand-300">
            <p className="font-semibold text-ink-900">Projektaufträge</p>
            <p className="mt-0.5 text-sm text-ink-600">Konkrete Vorhaben, für die jemand Unterstützung sucht – oder beschreibe selbst deinen Auftrag.</p>
            <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
              Zu den Aufträgen <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </span>
          </Link>
          <Link href={`/suche?kategorie=${related ?? 'marktplatz/dienstleistungen'}`} className="group rounded-xl border border-line bg-surface p-4 hover:border-brand-300">
            <p className="font-semibold text-ink-900">Inserate zu Dienstleistungen</p>
            <p className="mt-0.5 text-sm text-ink-600">Einzelne Angebote als Kleinanzeige im Marktplatz{related === 'jobs/freelance' ? ' bzw. unter Jobs › Freelance' : ''}.</p>
            <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
              Zu den Inseraten <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </span>
          </Link>
          <Link href="/konto/dienstleistungen" className="group rounded-xl border border-line bg-surface p-4 hover:border-brand-300">
            <p className="font-semibold text-ink-900">Selbst Dienstleistungen anbieten</p>
            <p className="mt-0.5 text-sm text-ink-600">Mit deinem bestehenden MarktAT-Konto ein Anbieterprofil anlegen – kostenlos.</p>
            <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
              Profil anlegen <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </span>
          </Link>
        </div>

        <p className="mt-6 flex gap-2 text-xs leading-relaxed text-ink-500">
          <BadgeInfo className="size-4 shrink-0" aria-hidden="true" />
          Die Angaben in den Profilen stammen von den Anbieterinnen und Anbietern selbst. MarktAT vermittelt nicht, schließt keine Verträge und wickelt keine Zahlungen ab. Für
          manche Tätigkeiten ist in Österreich eine Gewerbeberechtigung nötig – prüfe sie im Zweifel im GISA (Gewerbeinformationssystem Austria).
        </p>
      </section>
    </div>
  );
}

function EmptyState({ query }: { query: ServiceSearchQuery }) {
  const filtered = hasActiveServiceFilters(query);
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-6 py-12 text-center sm:py-14">
      {filtered ? <SearchX className="mx-auto size-8 text-ink-300" aria-hidden="true" /> : <UserRoundSearch className="mx-auto size-8 text-ink-300" aria-hidden="true" />}
      <p className="mt-3 font-semibold text-ink-900">{filtered ? 'Keine passenden Anbieter gefunden' : 'Noch keine Anbieterprofile'}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">
        {filtered
          ? 'Mit diesen Filtern gibt es gerade keine Anbieter. Vergrößere den Umkreis oder lockere die Filter.'
          : 'Hier erscheinen Profile von Freelancern und Dienstleistern, sobald sie welche anlegen.'}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {filtered ? (
          <Link href="/dienstleistungen" className={buttonClasses({ variant: 'outline' })}>
            Alle Filter zurücksetzen
          </Link>
        ) : null}
        <Link href="/konto/dienstleistungen" className={buttonClasses({ variant: filtered ? 'ghost' : 'primary' })}>
          Eigenes Profil anlegen
        </Link>
      </div>
    </div>
  );
}

function ServicesSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-[18rem_1fr] lg:gap-8">
      <Skeleton className="h-11 lg:h-[32rem]" />
      <div>
        <Skeleton className="mb-6 h-9 w-64" />
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      </div>
    </div>
  );
}
