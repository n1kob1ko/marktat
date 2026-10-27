'use client';

import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { flushSync } from 'react-dom';
import { Loader2, SlidersHorizontal, X } from 'lucide-react';
import { Input, Select, buttonClasses, cn } from '@marktat/ui';
import {
  CONDITION_PARAMS,
  ITEM_CONDITIONS,
  ITEM_CONDITION_LABELS,
  SEARCH_RADII,
  SELLER_TYPES,
  STATES,
  VERTICALS,
  VERTICAL_LABELS,
  VERTICAL_SLUGS,
  categoryAttributeSchema,
  hasItemCondition,
  hasPrice,
  searchFiltersFor,
  type CategoryNode,
  type LocationSummary,
  type OptionsFilter,
  type SearchFilter,
  type SearchQuery,
  type Vertical,
} from '@marktat/shared';
import { flattenCategories } from '@/lib/search';
import { LocationInput } from './location-input';

const COLLAPSED_OPTIONS = 6;
const DESKTOP = '(min-width: 64rem)';

const GENERAL_PARAMS = ['q', 'bereich', 'kategorie', 'ort', 'plz', 'umkreis', 'bundesland', 'anbieter', 'sortierung'];

/**
 * Formular → saubere Such-URL: leere Felder weg, Mehrfachauswahl kommagetrennt, Umkreis nur mit Ort.
 * Filter, die nicht zur gewählten Kategorie passen (z. B. nach einem Kategoriewechsel), fallen weg.
 */
export function formToSearch(entries: Iterable<[string, FormDataEntryValue]>): string {
  const grouped = new Map<string, string[]>();
  for (const [key, raw] of entries) {
    const value = String(raw).trim();
    if (!value) continue;
    grouped.set(key, [...(grouped.get(key) ?? []), value]);
  }
  if (!grouped.has('ort') && !grouped.has('plz')) grouped.delete('umkreis');
  if (grouped.has('ort')) grouped.delete('plz');
  // Kategorie gewählt: der Bereich ergibt sich daraus
  if (grouped.has('kategorie')) grouped.delete('bereich');

  const scope = grouped.get('kategorie')?.[0] ?? grouped.get('bereich')?.[0] ?? null;
  const allowed = new Set(GENERAL_PARAMS);
  if (hasPrice(scope)) allowed.add('preis_ab').add('preis_bis');
  if (hasItemCondition(scope)) allowed.add('zustand');
  for (const filter of searchFiltersFor(scope)) {
    if (filter.kind === 'range') allowed.add(`${filter.param}_ab`).add(`${filter.param}_bis`);
    else allowed.add(filter.param);
  }
  const params = new URLSearchParams();
  for (const [key, values] of grouped) if (allowed.has(key)) params.set(key, values.join(','));
  const text = params.toString();
  return text ? `/suche?${text}` : '/suche';
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

export function SearchFilters({
  query,
  categories,
  location,
  activeCount,
  total,
}: {
  query: SearchQuery;
  categories: CategoryNode[];
  location: LocationSummary | null;
  /** Anzahl aktiver Filter (für den Knopf auf dem Smartphone) */
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

  const initialCategory = query.category?.includes('/') ? query.category : '';
  const [vertical, setVertical] = useState<Vertical | ''>(
    initialCategory ? (VERTICALS.find((v) => initialCategory.startsWith(`${VERTICAL_SLUGS[v]}/`)) ?? '') : (query.vertical ?? ''),
  );
  const [categoryPath, setCategoryPath] = useState(initialCategory);
  const [hasLocation, setHasLocation] = useState(Boolean(query.locationId || query.postalCode));

  const scope = categoryPath || (vertical ? VERTICAL_SLUGS[vertical] : null);
  const filters = useMemo(() => searchFiltersFor(scope), [scope]);
  const flat = useMemo(() => flattenCategories(categories), [categories]);
  const showCondition = hasItemCondition(scope);
  const showPrice = hasPrice(scope);
  const rentOnly = categoryAttributeSchema(scope).fields.some((f) => f.key === 'offerType' && f.kind === 'select' && f.fixed === 'RENT');
  const priceLabel = rentOnly || query.attributes.offerType?.values?.join() === 'RENT' ? 'Monatsmiete' : 'Preis';

  const apply = () => {
    const form = formRef.current;
    if (!form) return;
    const href = formToSearch(new FormData(form));
    startTransition(() => router.push(href, { scroll: !desktop }));
    if (!desktop) setOpen(false);
  };

  // Desktop: Auswahlfelder wirken sofort, Zahlen und Text beim Verlassen des Feldes oder mit Enter
  const onChange = (event: FormEvent<HTMLFormElement>) => {
    if (!desktop) return;
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (target.type === 'checkbox' || target.type === 'radio' || target.tagName === 'SELECT') apply();
  };
  const onBlur = (event: React.FocusEvent<HTMLFormElement>) => {
    if (!desktop) return;
    const target = event.target as unknown as HTMLInputElement;
    if (target.tagName === 'INPUT' && (target.type === 'text' || target.type === 'search') && target.name && target.value !== target.defaultValue) apply();
  };

  // Mobiles Filtermenü: Escape schließt, Hintergrund scrollt nicht, Fokus wandert ins Menü und zurück
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

  const categoryOptions = flat.filter((c) => !vertical || c.node.vertical === vertical);

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
          {activeCount ? (
            <span className="rounded-full bg-brand-700 px-2 py-0.5 text-xs font-semibold text-white">{activeCount}</span>
          ) : null}
        </button>
      </div>

      <div
        role={open && !desktop ? 'dialog' : undefined}
        aria-modal={open && !desktop ? true : undefined}
        aria-label="Filter"
        className={cn(
          open ? 'fixed inset-0 z-50 flex flex-col bg-surface' : 'hidden',
          'lg:static lg:z-auto lg:block lg:bg-transparent',
        )}
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
          action="/suche"
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

            <Group label="Suchbegriff" htmlFor="f-q">
              <Input id="f-q" name="q" type="search" defaultValue={query.q ?? ''} placeholder="z. B. Rennrad, Sofa" maxLength={100} />
            </Group>

            <fieldset className="space-y-3">
              <legend className="mb-1.5 text-sm font-semibold text-ink-900">Kategorie</legend>
              <div className="space-y-1.5">
                <label htmlFor="f-bereich" className="sr-only">Bereich</label>
                <Select
                  id="f-bereich"
                  name="bereich"
                  value={vertical ? VERTICAL_SLUGS[vertical] : ''}
                  onChange={(e) => {
                    const next = VERTICALS.find((v) => VERTICAL_SLUGS[v] === e.target.value) ?? '';
                    setVertical(next);
                    if (categoryPath && next && !categoryPath.startsWith(`${VERTICAL_SLUGS[next]}/`)) setCategoryPath('');
                    if (!next) setCategoryPath('');
                  }}
                >
                  <option value="">Alle Bereiche</option>
                  {VERTICALS.map((v) => (
                    <option key={v} value={VERTICAL_SLUGS[v]}>{VERTICAL_LABELS[v]}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="f-kategorie" className="sr-only">Kategorie</label>
                <Select
                  id="f-kategorie"
                  name="kategorie"
                  value={categoryPath}
                  onChange={(e) => {
                    setCategoryPath(e.target.value);
                    const match = flat.find((c) => c.node.path === e.target.value);
                    if (match) setVertical(match.node.vertical);
                  }}
                >
                  <option value="">Alle Kategorien</option>
                  {categoryOptions.map(({ node, depth }) => (
                    <option key={node.id} value={node.path}>
                      {`${' '.repeat(depth)}${node.name}`}
                    </option>
                  ))}
                </Select>
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="mb-1.5 text-sm font-semibold text-ink-900">Standort</legend>
              <label htmlFor="f-ort" className="sr-only">PLZ oder Ort</label>
              <LocationInput
                initial={location}
                initialPostalCode={query.postalCode}
                onChange={(has, committed) => {
                  if (!committed || !desktop) return setHasLocation(has);
                  // Gewählten Ort und freigeschalteten Umkreis erst ins Formular schreiben, dann suchen
                  flushSync(() => setHasLocation(has));
                  apply();
                }}
              />
              <div className="space-y-1.5">
                <label htmlFor="f-umkreis" className="text-sm text-ink-700">Umkreis</label>
                <Select id="f-umkreis" name="umkreis" defaultValue={query.radiusKm ? String(query.radiusKm) : ''} disabled={!hasLocation}>
                  <option value="">Nur diese PLZ</option>
                  {SEARCH_RADII.map((km) => (
                    <option key={km} value={km}>+ {km} km</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="f-bundesland" className="text-sm text-ink-700">Bundesland</label>
                <Select id="f-bundesland" name="bundesland" defaultValue={query.state ?? ''}>
                  <option value="">Ganz Österreich</option>
                  {STATES.map((s) => (
                    <option key={s.slug} value={s.slug}>{s.name}</option>
                  ))}
                </Select>
              </div>
            </fieldset>

            {showPrice ? (
              <RangeInputs legend={`${priceLabel} in €`} param="preis" min={query.priceMin} max={query.priceMax} />
            ) : null}

            {filters.length ? (
              <div className="space-y-6 border-t border-line pt-5">
                {filters.map((filter) => (
                  <AttributeFilter key={filter.key} filter={filter} value={query.attributes[filter.key]} />
                ))}
              </div>
            ) : null}

            {showCondition ? (
              <fieldset className="space-y-2 border-t border-line pt-5">
                <legend className="mb-1.5 text-sm font-semibold text-ink-900">Zustand</legend>
                {ITEM_CONDITIONS.map((condition) => (
                  <CheckOption
                    key={condition}
                    name="zustand"
                    value={CONDITION_PARAMS[condition]}
                    label={ITEM_CONDITION_LABELS[condition]}
                    defaultChecked={query.conditions?.includes(condition)}
                  />
                ))}
              </fieldset>
            ) : null}

            <fieldset className="space-y-2 border-t border-line pt-5">
              <legend className="mb-1.5 text-sm font-semibold text-ink-900">Anbieter</legend>
              {(
                [
                  ['', 'Alle'],
                  ...Object.entries(SELLER_TYPES),
                ] as [string, string][]
              ).map(([value, label]) => (
                <label key={value || 'alle'} className="flex cursor-pointer items-center gap-3 text-sm text-ink-800">
                  <input
                    type="radio"
                    name="anbieter"
                    value={value}
                    defaultChecked={(query.seller ?? '') === value}
                    className="size-4.5 accent-brand-700"
                  />
                  {label}
                </label>
              ))}
            </fieldset>

            {query.sort !== (query.q ? 'relevanz' : 'neueste') ? <input type="hidden" name="sortierung" value={query.sort} /> : null}

            <button type="submit" className={buttonClasses({ className: 'hidden w-full lg:inline-flex' })}>
              Filter anwenden
            </button>
          </div>

          <div className="flex gap-3 border-t border-line bg-surface px-4 py-3 lg:hidden">
            <a href={query.q ? `/suche?${new URLSearchParams({ q: query.q })}` : '/suche'} className={buttonClasses({ variant: 'outline', className: 'flex-1' })}>
              Zurücksetzen
            </a>
            <button type="submit" className={buttonClasses({ className: 'flex-[2]' })}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {total === null ? 'Anzeigen' : `${total.toLocaleString('de-AT')} ${total === 1 ? 'Anzeige' : 'Anzeigen'}`}
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

function CheckOption({ name, value, label, defaultChecked }: { name: string; value: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 text-sm text-ink-800">
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} className="size-4.5 shrink-0 rounded accent-brand-700" />
      {label}
    </label>
  );
}

function RangeInputs({ legend, param, min, max, unit }: { legend: string; param: string; min?: number; max?: number; unit?: string }) {
  const format = (n: number | undefined) => (n === undefined ? '' : String(n).replace('.', ','));
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1.5 text-sm font-semibold text-ink-900">{legend}</legend>
      <div className="grid grid-cols-2 gap-2">
        <label className="sr-only" htmlFor={`f-${param}-ab`}>{legend} von</label>
        <Input id={`f-${param}-ab`} name={`${param}_ab`} type="text" inputMode="decimal" placeholder="von" defaultValue={format(min)} autoComplete="off" />
        <label className="sr-only" htmlFor={`f-${param}-bis`}>{legend} bis</label>
        <Input id={`f-${param}-bis`} name={`${param}_bis`} type="text" inputMode="decimal" placeholder="bis" defaultValue={format(max)} autoComplete="off" />
      </div>
      {unit ? <p className="text-xs text-ink-500">in {unit}</p> : null}
    </fieldset>
  );
}

function AttributeFilter({ filter, value }: { filter: SearchFilter; value: SearchQuery['attributes'][string] | undefined }) {
  switch (filter.kind) {
    case 'options':
      return <OptionsGroup filter={filter} selected={value?.values ?? []} />;
    case 'range':
      return <RangeInputs legend={filter.label} param={filter.param} min={value?.min} max={value?.max} unit={filter.euro ? '€ brutto' : filter.unit} />;
    case 'words':
      return (
        <Group label={filter.label} htmlFor={`f-${filter.param}`}>
          <Input id={`f-${filter.param}`} name={filter.param} type="text" defaultValue={value?.words?.join(' ') ?? ''} placeholder={filter.placeholder} maxLength={60} />
        </Group>
      );
    case 'flag':
      return <CheckOption name={filter.param} value="ja" label={filter.label} defaultChecked={value?.flag} />;
  }
}

function OptionsGroup({ filter, selected }: { filter: OptionsFilter; selected: string[] }) {
  const hiddenSelected = filter.options.slice(COLLAPSED_OPTIONS).some((o) => selected.includes(o.value));
  const [expanded, setExpanded] = useState(hiddenSelected);
  const visible = expanded ? filter.options : filter.options.slice(0, COLLAPSED_OPTIONS);
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 text-sm font-semibold text-ink-900">
        {filter.label}
        {filter.match === 'all' ? <span className="ml-1 font-normal text-ink-500">(alle gewählten)</span> : null}
      </legend>
      {visible.map((option) => (
        <CheckOption key={option.value} name={filter.param} value={option.value} label={option.label} defaultChecked={selected.includes(option.value)} />
      ))}
      {filter.options.length > COLLAPSED_OPTIONS ? (
        <button type="button" onClick={() => setExpanded((e) => !e)} className="text-sm font-semibold text-brand-700 hover:underline">
          {expanded ? 'Weniger anzeigen' : `Alle ${filter.options.length} anzeigen`}
        </button>
      ) : null}
    </fieldset>
  );
}
