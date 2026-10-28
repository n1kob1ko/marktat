import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowRight, BadgeInfo, ClipboardList, SearchX, X } from 'lucide-react';
import { buttonClasses, Container, Input, Select, Skeleton } from '@marktat/ui';
import {
  PROJECT_MAX_CONTACTS,
  PROJECT_SORT_LABELS,
  SEARCH_RADII,
  SERVICE_CATEGORY_GROUPS,
  hasActiveProjectFilters,
  parseProjectSearchParams,
  projectSearchHref,
  serviceCategoryBySlug,
  serviceGroupBySlug,
  type ProjectSearchQuery,
  type ProjectSearchResult,
  type ProjectSort,
} from '@marktat/shared';
import { api } from '@/lib/api';
import { projectChips } from '@/lib/projects';
import { ProjectCard } from '@/components/services/project-card';
import { SortSelect } from '@/components/search/sort-select';
import { Pagination } from '@/components/pagination';

type Params = Record<string, string | string[] | undefined>;

const DESCRIPTION = 'Konkrete Vorhaben, für die Privatpersonen und Betriebe in Österreich eine Dienstleistung suchen. Antworten über die Nachrichten von MarktAT, ohne Provision.';

/** Nur die Übersicht wird indexiert; gefilterte Varianten nicht */
export async function generateMetadata({ searchParams }: PageProps<'/dienstleistungen/projekte'>): Promise<Metadata> {
  const params = await searchParams;
  const filtered = Object.keys(params).some((key) => params[key] !== undefined && key !== 'seite');
  return {
    title: 'Projektaufträge – Dienstleistungen',
    description: DESCRIPTION,
    alternates: { canonical: '/dienstleistungen/projekte' },
    ...(filtered ? { robots: { index: false, follow: true } } : {}),
  };
}

export default function ProjectsPage({ searchParams }: PageProps<'/dienstleistungen/projekte'>) {
  return (
    <>
      <section className="border-b border-line bg-accent-50/60">
        <Container className="py-6 sm:py-8">
          <nav aria-label="Brotkrümel" className="text-sm text-ink-500">
            <Link href="/dienstleistungen" className="hover:text-brand-700 hover:underline">Dienstleistungen</Link>
          </nav>
          <h1 className="mt-1 text-2xl font-bold text-balance text-ink-950 sm:text-3xl">Projektaufträge</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-600">
            Hier beschreiben Menschen und Betriebe ein konkretes Vorhaben – etwa eine Website, ein ausgemaltes Stiegenhaus oder Nachhilfe bis zur Matura – und suchen
            dafür eine selbstständige Dienstleistung. <strong className="font-semibold text-ink-800">Kein Jobangebot und keine Ausschreibung:</strong> Es gibt keine
            Anstellung, keine Gebote und keine Vergabe über MarktAT. Antworten können Anbieter:innen mit sichtbarem Anbieterprofil, höchstens {PROJECT_MAX_CONTACTS} je Auftrag.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/konto/projekte/neu" className={buttonClasses({ size: 'sm' })}>Auftrag beschreiben</Link>
            <Link href="/suche?bereich=jobs" className={buttonClasses({ variant: 'outline', size: 'sm' })}>Stellenangebote unter Jobs</Link>
          </div>
        </Container>
      </section>
      <Container className="py-6 sm:py-8">
        <Suspense fallback={<ProjectsSkeleton />}>
          <ProjectResults searchParams={searchParams} />
        </Suspense>
      </Container>
    </>
  );
}

async function ProjectResults({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  // Das Filterformular schickt „Alles in …“ als kategorie=bereich:<slug> – in die saubere URL umleiten
  const rawCategory = [params.kategorie].flat()[0];
  if (rawCategory?.startsWith('bereich:')) {
    const { query } = parseProjectSearchParams({ ...params, kategorie: undefined, bereich: rawCategory.slice('bereich:'.length) });
    redirect(projectSearchHref(query));
  }
  // Ungültige Werte werden ignoriert (die API würde mit 400 antworten)
  const { query, issues } = parseProjectSearchParams(params);
  for (const issue of issues) {
    if (issue.param === 'kategorie') delete query.category;
    if (issue.param === 'bereich') delete query.group;
    if (issue.param === 'plz') delete query.postalCode;
    if (issue.param === 'ort') delete query.locationId;
  }
  const apiParams = new URLSearchParams(projectSearchHref(query).split('?')[1] ?? '');
  let result: ProjectSearchResult | null = null;
  try {
    result = await api<ProjectSearchResult>(`/projects?${apiParams}`, { cache: 'no-store' });
  } catch {
    result = null;
  }
  if (result && query.page > 1 && result.totalPages > 0 && query.page > result.totalPages) redirect(projectSearchHref({ ...query, page: result.totalPages }));

  const location = result?.location ?? null;
  const chips = projectChips(query, location);
  const category = query.category ? serviceCategoryBySlug(query.category) : undefined;
  const group = query.group ? serviceGroupBySlug(query.group) : undefined;
  const heading = query.q ? `Aufträge zu „${query.q}“` : (category?.name ?? group?.name ?? 'Alle Aufträge');
  const sorts: ProjectSort[] = ['neueste', ...(location ? (['entfernung'] as const) : [])];
  const sortHrefs = Object.fromEntries(sorts.map((sort) => [sort, projectSearchHref({ ...query, sort, page: 1 })]));

  return (
    <div className="grid gap-5 lg:grid-cols-[18rem_1fr] lg:gap-8">
      <aside aria-label="Filter" className="lg:self-start">
        <ProjectFilters query={query} />
      </aside>

      <section aria-labelledby="projects-heading" className="min-w-0">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h2 id="projects-heading" className="text-xl font-bold text-ink-950 sm:text-2xl">{heading}</h2>
            {result ? (
              <p className="mt-1 text-sm text-ink-500" aria-live="polite">
                {result.total.toLocaleString('de-AT')} {result.total === 1 ? 'Projektauftrag' : 'Projektaufträge'}
              </p>
            ) : null}
          </div>
          {result && result.total > 1 && sorts.length > 1 ? <SortSelect value={query.sort} options={sorts} hrefFor={sortHrefs} labels={PROJECT_SORT_LABELS} /> : null}
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
          </div>
        ) : null}

        <div className="mt-6">
          {!result ? (
            <p className="rounded-xl border border-line bg-surface p-6 text-ink-600" role="alert">
              Die Aufträge sind gerade nicht erreichbar. Bitte versuche es gleich noch einmal.
            </p>
          ) : result.items.length === 0 ? (
            <EmptyState query={query} />
          ) : (
            <>
              <ul aria-label="Projektaufträge" className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
                {result.items.map((project) => (
                  <li key={project.id} className="flex">
                    <ProjectCard project={project} />
                  </li>
                ))}
              </ul>
              <Pagination page={query.page} totalPages={result.totalPages} hrefFor={(page) => projectSearchHref({ ...query, page })} />
            </>
          )}
        </div>

        <Link href="/dienstleistungen" className="group mt-8 block rounded-xl border border-line bg-surface p-4 hover:border-brand-300">
          <p className="font-semibold text-ink-900">Lieber selbst Anbieter:innen suchen?</p>
          <p className="mt-0.5 text-sm text-ink-600">Profile von Freelancern, Handwerksbetrieben und Dienstleistern durchsuchen und direkt anschreiben.</p>
          <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
            Zu den Anbieterprofilen <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </span>
        </Link>

        <p className="mt-6 flex gap-2 text-xs leading-relaxed text-ink-500">
          <BadgeInfo className="size-4 shrink-0" aria-hidden="true" />
          Die Angaben in den Aufträgen stammen von den Auftraggeber:innen selbst. MarktAT vermittelt nicht, schließt keine Verträge und wickelt keine Zahlungen ab. Aufträge, die in
          Wahrheit ein Arbeitsverhältnis beschreiben (fixe Arbeitszeiten, Weisungen, Eingliederung in einen Betrieb), gehören unter Jobs – bitte melde sie.
        </p>
      </section>
    </div>
  );
}

/**
 * Filter als normales GET-Formular: funktioniert ohne JavaScript. Smartphone: aufklappbar über den Ergebnissen,
 * Desktop: immer sichtbar in der Seitenleiste.
 */
function ProjectFilters({ query }: { query: ProjectSearchQuery }) {
  const active = hasActiveProjectFilters(query);
  return (
    <>
      <details className="group rounded-[var(--radius-card)] border border-line bg-surface lg:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 py-2.5 font-semibold text-ink-900">
          Filter{active ? ' (aktiv)' : ''}
          <span className="text-sm font-normal text-brand-700 group-open:hidden">anzeigen</span>
          <span className="hidden text-sm font-normal text-brand-700 group-open:inline">ausblenden</span>
        </summary>
        <div className="border-t border-line p-4">
          <ProjectFilterForm query={query} idPrefix="pm" />
        </div>
      </details>
      <div className="hidden rounded-[var(--radius-card)] border border-line bg-surface p-5 lg:block">
        <h2 className="mb-5 font-sans text-base font-semibold tracking-normal">Filter</h2>
        <ProjectFilterForm query={query} idPrefix="pd" />
      </div>
    </>
  );
}

function ProjectFilterForm({ query, idPrefix }: { query: ProjectSearchQuery; idPrefix: string }) {
  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <form action="/dienstleistungen/projekte" className="space-y-5" data-testid="project-filters">
      <div className="space-y-1.5">
        <label htmlFor={id('q')} className="block text-sm font-semibold text-ink-900">Suchbegriff</label>
        <Input id={id('q')} name="q" type="search" defaultValue={query.q ?? ''} placeholder="z. B. Website, Umzug, Mathe" maxLength={100} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={id('kategorie')} className="block text-sm font-semibold text-ink-900">Kategorie</label>
        <Select id={id('kategorie')} name="kategorie" defaultValue={query.category ?? (query.group ? `bereich:${query.group}` : '')}>
          <option value="">Alle Kategorien</option>
          {SERVICE_CATEGORY_GROUPS.map((group) => (
            <optgroup key={group.slug} label={group.name}>
              <option value={`bereich:${group.slug}`}>Alles in {group.name}</option>
              {group.categories.map((c) => (
                <option key={c.slug} value={c.slug}>{c.name}</option>
              ))}
            </optgroup>
          ))}
        </Select>
      </div>
      <fieldset className="space-y-3">
        <legend className="mb-1.5 text-sm font-semibold text-ink-900">Wo?</legend>
        <div className="grid grid-cols-[6rem_1fr] gap-2">
          <div className="space-y-1.5">
            <label htmlFor={id('plz')} className="text-sm text-ink-700">PLZ</label>
            <Input id={id('plz')} name="plz" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} defaultValue={query.postalCode ?? ''} autoComplete="postal-code" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={id('umkreis')} className="text-sm text-ink-700">Umkreis</label>
            <Select id={id('umkreis')} name="umkreis" defaultValue={query.radiusKm ? String(query.radiusKm) : ''}>
              <option value="">Nur dieser Ort</option>
              {SEARCH_RADII.map((km) => (
                <option key={km} value={km}>+ {km} km</option>
              ))}
            </Select>
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-3 text-sm text-ink-800">
          <input type="checkbox" name="remote" value="ja" defaultChecked={query.remote} className="size-4.5 accent-brand-700" />
          Nur remote erledigbare Aufträge
        </label>
        <p className="text-xs text-ink-500">Mit „remote“ spielt der Ort keine Rolle.</p>
      </fieldset>
      <div className="flex gap-2">
        <button type="submit" className={buttonClasses({ className: 'flex-1' })}>Anzeigen</button>
        {hasActiveProjectFilters(query) ? (
          <Link href="/dienstleistungen/projekte" className={buttonClasses({ variant: 'outline' })}>Zurücksetzen</Link>
        ) : null}
      </div>
    </form>
  );
}

function EmptyState({ query }: { query: ProjectSearchQuery }) {
  const filtered = hasActiveProjectFilters(query);
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-6 py-12 text-center sm:py-14">
      {filtered ? <SearchX className="mx-auto size-8 text-ink-300" aria-hidden="true" /> : <ClipboardList className="mx-auto size-8 text-ink-300" aria-hidden="true" />}
      <p className="mt-3 font-semibold text-ink-900">{filtered ? 'Keine passenden Aufträge gefunden' : 'Noch keine Projektaufträge'}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">
        {filtered ? 'Mit diesen Filtern gibt es gerade keine Aufträge. Vergrößere den Umkreis oder lockere die Filter.' : 'Hier erscheinen Vorhaben, sobald jemand eines beschreibt.'}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {filtered ? (
          <Link href="/dienstleistungen/projekte" className={buttonClasses({ variant: 'outline' })}>
            Alle Filter zurücksetzen
          </Link>
        ) : null}
        <Link href="/konto/projekte/neu" className={buttonClasses({ variant: filtered ? 'ghost' : 'primary' })}>
          Eigenen Auftrag beschreiben
        </Link>
      </div>
    </div>
  );
}

function ProjectsSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-[18rem_1fr] lg:gap-8">
      <Skeleton className="h-11 lg:h-96" />
      <div>
        <Skeleton className="mb-6 h-9 w-64" />
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      </div>
    </div>
  );
}
