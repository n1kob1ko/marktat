'use client';

import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { flushSync } from 'react-dom';
import { Loader2, SlidersHorizontal, X } from 'lucide-react';
import { Input, Select, buttonClasses, cn } from '@marktat/ui';
import {
  DEAL_CHANNEL_PARAMS,
  DEAL_DISCOUNT_STEPS,
  SEARCH_RADII,
  STATES,
  type DealCategoryView,
  type DealSearchQuery,
  type LocationSummary,
} from '@marktat/shared';
import { LocationInput } from '@/components/search/location-input';

const DESKTOP = '(min-width: 64rem)';
const PARAMS = ['q', 'kategorie', 'kanal', 'ort', 'plz', 'umkreis', 'bundesland', 'preis_ab', 'preis_bis', 'rabatt_ab', 'haendler', 'sortierung'];

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
}: {
  query: DealSearchQuery;
  categories: DealCategoryView[];
  location: LocationSummary | null;
  activeCount: number;
  total: number | null;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const desktop = useIsDesktop();
  const [open, setOpen] = useState(false);
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
          {activeCount ? <span className="rounded-full bg-brand-700 px-2 py-0.5 text-xs font-semibold text-white">{activeCount}</span> : null}
        </button>
      </div>

      <div
        role={open && !desktop ? 'dialog' : undefined}
        aria-modal={open && !desktop ? true : undefined}
        aria-label="Filter"
        className={cn(open ? 'fixed inset-0 z-50 flex flex-col bg-surface' : 'hidden', 'lg:static lg:z-auto lg:block lg:bg-transparent')}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3 lg:hidden">
          <h2 className="font-sans text-lg font-semibold tracking-normal">Filter</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={() => setOpen(false)}
            className="flex size-10 items-center justify-center rounded-xl text-ink-600 hover:bg-canvas"
            aria-label="Filter schließen"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

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

            <Group label="Kategorie" htmlFor="d-kategorie">
              <Select id="d-kategorie" name="kategorie" defaultValue={query.category ?? ''}>
                <option value="">Alle Kategorien</option>
                {categories.map((c) => (
                  <option key={c.slug} value={c.slug}>{c.name}</option>
                ))}
              </Select>
            </Group>

            <fieldset className="space-y-2">
              <legend className="mb-1.5 text-sm font-semibold text-ink-900">Wo gilt das Angebot?</legend>
              {([['', 'Online und im Geschäft'], ...Object.entries(DEAL_CHANNEL_PARAMS)] as [string, string][]).map(([value, label]) => (
                <label key={value || 'alle'} className="flex cursor-pointer items-center gap-3 text-sm text-ink-800">
                  <input type="radio" name="kanal" value={value} defaultChecked={(query.channel ?? '') === value} className="size-4.5 accent-brand-700" />
                  {label}
                </label>
              ))}
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="mb-1.5 text-sm font-semibold text-ink-900">Geschäfte in der Nähe</legend>
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
            </fieldset>

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

            {query.merchantId ? <input type="hidden" name="haendler" value={query.merchantId} /> : null}
            {query.sort !== (query.q ? 'relevanz' : 'neueste') ? <input type="hidden" name="sortierung" value={query.sort} /> : null}

            <button type="submit" className={buttonClasses({ className: 'hidden w-full lg:inline-flex' })}>
              Filter anwenden
            </button>
          </div>

          <div className="flex gap-3 border-t border-line bg-surface px-4 py-3 lg:hidden">
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
