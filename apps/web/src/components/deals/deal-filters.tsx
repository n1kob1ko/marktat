'use client';

import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { flushSync } from 'react-dom';
import { ChevronDown, Loader2, SlidersHorizontal } from 'lucide-react';
import { Input, Select, buttonClasses, cn } from '@marktat/ui';
import { MOTION, usePresence } from '@/lib/motion';
import { SheetHeader } from '@/components/sheet-header';
import {
  DEAL_CHANNEL_PARAMS,
  DEAL_DISCOUNT_STEPS,
  dealDefaultSort,
  SEARCH_RADII,
  STATES,
  type DealCategoryView,
  type DealFacets,
  type DealFacetValue,
  type DealSearchQuery,
  type LocationSummary,
} from '@marktat/shared';
import { LocationInput } from '@/components/search/location-input';

const DESKTOP = '(min-width: 64rem)';
const PARAMS = ['q', 'shop', 'kategorie', 'marke', 'kanal', 'ort', 'plz', 'umkreis', 'bundesland', 'preis_ab', 'preis_bis', 'rabatt_ab', 'haendler', 'sortierung'];

/** Formular → saubere Deal-URL: leere Felder weg, Umkreis nur mit Ort */
export function formToDealSearch(entries: Iterable<[string, FormDataEntryValue]>): string {
  const params = new URLSearchParams();
  for (const [key, raw] of entries) {
    const value = String(raw).trim();
    if (value && PARAMS.includes(key)) params.set(key, value);
  }
  if (!params.has('ort') && !params.has('plz')) {
    params.delete('umkreis');
    if (params.get('sortierung') === 'entfernung') params.delete('sortierung');
  }
  if (params.has('ort')) params.delete('plz');
  const text = params.toString();
  return text ? `/deals?${text}` : '/deals';
}

function useIsDesktop() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(DESKTOP);
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return desktop;
}

/** Filter der Deals. Desktop: Seitenleiste, Auswahl wirkt sofort. Smartphone: Vollbild-Dialog mit „Anzeigen“. */
export function DealFilters({
  query,
  categories,
  location,
  activeCount,
  total,
  facets,
}: {
  query: DealSearchQuery;
  categories: DealCategoryView[];
  location: LocationSummary | null;
  activeCount: number;
  total: number | null;
  facets: DealFacets | null;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const desktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const leaving = usePresence(open, MOTION.sheetExit);
  const closing = !open && leaving.present;
  const [pending, startTransition] = useTransition();
  const [hasLocation, setHasLocation] = useState(Boolean(query.locationId || query.postalCode));

  const apply = () => {
    const form = formRef.current;
    if (!form) return;
    const href = formToDealSearch(new FormData(form));
    startTransition(() => router.push(href, { scroll: !desktop }));
    if (!desktop) setOpen(false);
  };

  const onChange = (event: FormEvent<HTMLFormElement>) => {
    if (!desktop) return;
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (target.type === 'radio' || target.tagName === 'SELECT') apply();
  };
  const onBlur = (event: React.FocusEvent<HTMLFormElement>) => {
    if (!desktop) return;
    const target = event.target as unknown as HTMLInputElement;
    if (target.tagName === 'INPUT' && (target.type === 'text' || target.type === 'search') && target.name && target.value !== target.defaultValue) apply();
  };

  useEffect(() => {
    if (!open || desktop) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    const trigger = triggerRef.current;
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
      trigger?.focus();
    };
  }, [open, desktop]);

  const format = (n: number | undefined) => (n === undefined ? '' : String(n).replace('.', ','));
  const nearbyActive = Boolean(query.locationId || query.postalCode || query.state);
  // Mit Zählung: nur Kategorien mit passenden Angeboten (die gewählte bleibt immer sichtbar)
  const categoryOptions = facets ? categories.filter((c) => (facets.categories[c.slug] ?? 0) > 0 || c.slug === query.category) : categories;

  return (
    <>
      <div className="lg:hidden">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={buttonClasses({ variant: 'outline', className: 'w-full justify-center gap-2' })}
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          Filter
          {activeCount ? <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-white">{activeCount}</span> : null}
        </button>
      </div>

      <div
        role={open && !desktop ? 'dialog' : undefined}
        aria-modal={open && !desktop ? true : undefined}
        aria-label="Filter"
        data-open={open}
        // Während des Ausblendens nicht mehr bedienbar und für Vorlesesoftware schon weg
        inert={closing}
        aria-hidden={closing || undefined}
        className={cn('sheet max-lg:safe-x max-lg:fixed max-lg:inset-0 max-lg:z-50 max-lg:flex-col max-lg:bg-surface lg:block', open ? 'max-lg:flex' : 'max-lg:hidden')}
      >
        <SheetHeader title="Filter" closeLabel="Filter schließen" onClose={() => setOpen(false)} closeRef={closeRef} />

        <form
          ref={formRef}
          action="/deals"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
          onChange={onChange}
          onBlur={onBlur}
          className="flex min-h-0 flex-1 flex-col lg:block"
          aria-busy={pending}
        >
          <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5 lg:overflow-visible lg:rounded-[var(--radius-card)] lg:border lg:border-line lg:bg-surface lg:p-5">
            <div className="hidden items-center justify-between lg:flex">
              <h2 className="font-sans text-base font-semibold tracking-normal">Filter</h2>
              {pending ? (
                <span className="flex items-center gap-1.5 text-xs text-ink-500" role="status">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Wird aktualisiert
                </span>
              ) : null}
            </div>

            <Group label="Suchbegriff" htmlFor="d-q">
              <Input id="d-q" name="q" type="search" defaultValue={query.q ?? ''} placeholder="z. B. Laptop, Kaffee" maxLength={100} />
            </Group>

            <Group label="Shop" htmlFor="d-shop">
              <FacetSelect id="d-shop" name="shop" value={query.shop} values={facets?.shops} allLabel="Alle Shops" />
            </Group>

            <Group label="Kategorie" htmlFor="d-kategorie">
              <Select id="d-kategorie" name="kategorie" defaultValue={query.category ?? ''}>
                <option value="">Alle Kategorien</option>
                {categoryOptions.map((c) => (
                  <option key={c.slug} value={c.slug}>{withCount(c.name, facets?.categories[c.slug])}</option>
                ))}
              </Select>
            </Group>

            <Group label="Marke" htmlFor="d-marke">
              <FacetSelect id="d-marke" name="marke" value={query.brand} values={facets?.brands} allLabel="Alle Marken" />
            </Group>

            <fieldset className="space-y-1.5">
              <legend className="mb-1.5 text-sm font-semibold text-ink-900">Preis in €</legend>
              <div className="grid grid-cols-2 gap-2">
                <label className="sr-only" htmlFor="d-preis-ab">Preis von</label>
                <Input id="d-preis-ab" name="preis_ab" type="text" inputMode="decimal" placeholder="von" defaultValue={format(query.priceMin)} autoComplete="off" />
                <label className="sr-only" htmlFor="d-preis-bis">Preis bis</label>
                <Input id="d-preis-bis" name="preis_bis" type="text" inputMode="decimal" placeholder="bis" defaultValue={format(query.priceMax)} autoComplete="off" />
              </div>
            </fieldset>

            <Group label="Rabatt" htmlFor="d-rabatt">
              <Select id="d-rabatt" name="rabatt_ab" defaultValue={query.discountMin ? String(query.discountMin) : ''}>
                <option value="">Alle Angebote</option>
                {DEAL_DISCOUNT_STEPS.map((p) => (
                  <option key={p} value={p}>ab {p} %</option>
                ))}
              </Select>
              <p className="text-xs text-ink-500">Nur Angebote mit belegtem Vergleichspreis haben einen Rabatt.</p>
            </Group>

            <label className="flex cursor-pointer items-start gap-3 text-sm text-ink-800">
              <input type="checkbox" name="zubehoer" value="aus" defaultChecked={query.hideAccessories} className="mt-0.5 size-4.5 shrink-0 accent-brand-700" />
              <span>
                <span className="font-semibold text-ink-900">Zubehör ausblenden</span>
                <span className="block text-xs text-ink-500">Hüllen, Schutzgläser, Kabel, Adapter, Ersatzteile</span>
              </span>
            </label>

            <fieldset className="space-y-2">
              <legend className="mb-1.5 text-sm font-semibold text-ink-900">Wo gilt das Angebot?</legend>
              {([['', 'Online und im Geschäft'], ...Object.entries(DEAL_CHANNEL_PARAMS)] as [string, string][]).map(([value, label]) => (
                <label key={value || 'alle'} className="flex cursor-pointer items-center gap-3 text-sm text-ink-800">
                  <input type="radio" name="kanal" value={value} defaultChecked={(query.channel ?? '') === value} className="size-4.5 accent-brand-700" />
                  {label}
                </label>
              ))}
            </fieldset>

            {/* Selten gebraucht (Filialen der Händler): zugeklappt, außer ein Ortsfilter ist aktiv */}
            <details open={nearbyActive || undefined} className="group border-t border-line pt-4">
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-ink-900 [&::-webkit-details-marker]:hidden">
                Geschäfte in der Nähe
                <ChevronDown className="size-4 text-ink-500 transition-transform duration-200 ease-in-out group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="mt-3 space-y-3">
                <label htmlFor="f-ort" className="sr-only">PLZ oder Ort</label>
                <LocationInput
                  initial={location}
                  initialPostalCode={query.postalCode}
                  onChange={(has, committed) => {
                    if (!committed || !desktop) return setHasLocation(has);
                    flushSync(() => setHasLocation(has));
                    apply();
                  }}
                />
                <div className="space-y-1.5">
                  <label htmlFor="d-umkreis" className="text-sm text-ink-700">Umkreis</label>
                  <Select id="d-umkreis" name="umkreis" defaultValue={query.radiusKm ? String(query.radiusKm) : ''} disabled={!hasLocation}>
                    <option value="">Nur diese PLZ</option>
                    {SEARCH_RADII.map((km) => (
                      <option key={km} value={km}>+ {km} km</option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="d-bundesland" className="text-sm text-ink-700">Bundesland</label>
                  <Select id="d-bundesland" name="bundesland" defaultValue={query.state ?? ''}>
                    <option value="">Ganz Österreich</option>
                    {STATES.map((s) => (
                      <option key={s.slug} value={s.slug}>{s.name}</option>
                    ))}
                  </Select>
                </div>
                <p className="text-xs text-ink-500">Ort und Bundesland gelten für Angebote im Geschäft (Filialen der Händler).</p>
              </div>
            </details>


            {query.merchantId ? <input type="hidden" name="haendler" value={query.merchantId} /> : null}
            {query.sort !== dealDefaultSort(query.q) ? <input type="hidden" name="sortierung" value={query.sort} /> : null}

            <button type="submit" className={buttonClasses({ className: 'hidden w-full lg:inline-flex' })}>
              Filter anwenden
            </button>
          </div>

          <div className="flex gap-3 border-t border-line bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
            <Link href="/deals" className={buttonClasses({ variant: 'outline', className: 'flex-1' })}>
              Zurücksetzen
            </Link>
            <button type="submit" className={buttonClasses({ className: 'flex-[2]' })}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {total === null ? 'Angebote anzeigen' : `${total.toLocaleString('de-AT')} ${total === 1 ? 'Angebot' : 'Angebote'}`}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function Group({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-ink-900">{label}</label>
      {children}
    </div>
  );
}

const withCount = (label: string, count: number | undefined) => (count === undefined ? label : `${label} (${count.toLocaleString('de-AT')})`);

/** Auswahl aus den Facetten der Suche (Shop, Marke); der gewählte Wert bleibt auch ohne Treffer wählbar */
function FacetSelect({ id, name, value, values, allLabel }: { id: string; name: string; value: string | undefined; values: DealFacetValue[] | undefined; allLabel: string }) {
  const list = values ?? [];
  const selected = value ? (list.find((v) => v.value.toLocaleLowerCase('de') === value.toLocaleLowerCase('de'))?.value ?? value) : '';
  const options = value && !list.some((v) => v.value === selected) ? [{ value, count: undefined }, ...list] : list;
  return (
    <Select id={id} name={name} defaultValue={selected} disabled={!options.length}>
      <option value="">{allLabel}</option>
      {options.map((v) => (
        <option key={v.value} value={v.value}>{withCount(v.value, v.count)}</option>
      ))}
    </Select>
  );
}
