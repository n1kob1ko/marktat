/**
 * Suchparameter: dieselben deutschen Namen in der Such-URL der Website und in `GET /v1/listings`,
 * damit jede Suche als Link geteilt werden kann, z. B.
 *   /suche?kategorie=marktplatz/sport-freizeit/fahrraeder&ort=123&umkreis=25&preis_bis=500
 */
import { stateBySlug, isAustrianPostalCode } from '../austria.js';
import { parseLocaleNumber } from '../attributes/validation.js';
import { ITEM_CONDITIONS, VERTICAL_SLUGS, VERTICALS, type ItemCondition, type Vertical } from '../enums.js';
import { filterWords, type SearchFilter } from './filters.js';

export const SEARCH_RADII = [5, 10, 25, 50, 100, 200] as const;
export type SearchRadius = (typeof SEARCH_RADII)[number];

export const SEARCH_SORTS = ['relevanz', 'neueste', 'preis_auf', 'preis_ab', 'entfernung'] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export const SEARCH_SORT_LABELS: Record<SearchSort, string> = {
  relevanz: 'Beste Treffer',
  neueste: 'Neueste zuerst',
  preis_auf: 'Preis aufsteigend',
  preis_ab: 'Preis absteigend',
  entfernung: 'Entfernung',
};

export const SELLER_TYPES = { privat: 'Privat', gewerblich: 'Gewerblich' } as const;
export type SellerType = keyof typeof SELLER_TYPES;

/** URL-Werte für den Artikelzustand */
export const CONDITION_PARAMS: Record<ItemCondition, string> = {
  NEW: 'neu',
  LIKE_NEW: 'wie-neu',
  GOOD: 'gut',
  ACCEPTABLE: 'akzeptabel',
  DEFECTIVE: 'defekt',
};

export const SEARCH_PAGE_SIZE = 24;
export const MAX_SEARCH_PAGE = 400;
const MAX_PRICE_EUR = 1_000_000_000;

export interface AttributeFilterValue {
  /** Auswahl */
  values?: string[];
  /** Bereich */
  min?: number;
  max?: number;
  /** Freitext */
  words?: string[];
  /** Ja/Nein */
  flag?: true;
}

export interface SearchQuery {
  q?: string;
  vertical?: Vertical;
  /** Kategoriepfad (oder eine Kategorie-ID aus alten Links, die API löst sie auf) */
  category?: string;
  state?: string;
  postalCode?: string;
  locationId?: number;
  radiusKm?: SearchRadius;
  /** Euro */
  priceMin?: number;
  priceMax?: number;
  seller?: SellerType;
  conditions?: ItemCondition[];
  sort: SearchSort;
  page: number;
  pageSize: number;
  /** nach Attributschlüssel */
  attributes: Record<string, AttributeFilterValue>;
}

export interface SearchParamIssue {
  param: string;
  message: string;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
const list = (value: string | string[] | undefined) =>
  [...new Set((Array.isArray(value) ? value : [value ?? '']).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean))];

/** Pfad (enthält „/“) oder alte Kategorie-ID */
export const isCategoryPath = (value: string) => value.includes('/');

/** Basis für die Filterauswahl: Kategoriepfad, sonst Bereich (z. B. „immobilien“). */
export function filterScope(query: Pick<SearchQuery, 'category' | 'vertical'>): string | null {
  if (query.category && isCategoryPath(query.category)) return query.category;
  if (query.category) return null;
  return query.vertical ? VERTICAL_SLUGS[query.vertical] : null;
}

/** Kategoriepfad oder Bereich aus den rohen Parametern – bestimmt, welche Eigenschaftsfilter gelten. */
export function peekFilterScope(input: RawSearchParams): string | null {
  const category = first(input.kategorie) ?? first(input.categoryId);
  const vertical = verticalFrom(first(input.bereich) ?? first(input.vertical));
  return filterScope({ category, vertical });
}

function verticalFrom(value: string | undefined): Vertical | undefined {
  if (!value) return undefined;
  return VERTICALS.find((v) => v === value || VERTICAL_SLUGS[v] === value);
}

function parseNumber(raw: string | undefined, param: string, issues: SearchParamIssue[], opts: { min: number; max: number; decimals: number }) {
  if (raw === undefined) return undefined;
  const value = parseLocaleNumber(raw);
  if (value === null || value < opts.min || value > opts.max) {
    issues.push({ param, message: `„${param}“ muss eine Zahl zwischen ${opts.min} und ${opts.max} sein.` });
    return undefined;
  }
  const factor = 10 ** opts.decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Liest Suchparameter aus URL bzw. Query-String.
 * Ungültige Werte werden ignoriert und als `issues` gemeldet: Die Website zeigt dann einfach ohne diesen
 * Filter an, die API antwortet mit 400.
 *
 * `filters` sind die Eigenschaftsfilter der gewählten Kategorie (`searchFiltersFor(peekFilterScope(input))`).
 * Alte Parameternamen der API (`categoryId`, `vertical`, `state`) werden weiter verstanden.
 */
export function parseSearchParams(input: RawSearchParams, filters: readonly SearchFilter[] = []): { query: SearchQuery; issues: SearchParamIssue[] } {
  const issues: SearchParamIssue[] = [];
  const query: SearchQuery = { sort: 'neueste', page: 1, pageSize: SEARCH_PAGE_SIZE, attributes: {} };

  const q = first(input.q);
  if (q) {
    if (q.length > 100) issues.push({ param: 'q', message: 'Der Suchbegriff darf höchstens 100 Zeichen lang sein.' });
    else query.q = q.replace(/\s+/g, ' ');
  }

  const verticalRaw = first(input.bereich) ?? first(input.vertical);
  if (verticalRaw) {
    const vertical = verticalFrom(verticalRaw);
    if (vertical) query.vertical = vertical;
    else issues.push({ param: 'bereich', message: 'Unbekannter Bereich.' });
  }

  const category = first(input.kategorie) ?? first(input.categoryId);
  if (category) {
    if (category.length <= 200 && /^[a-z0-9/-]+$/i.test(category)) query.category = category;
    else issues.push({ param: 'kategorie', message: 'Unbekannte Kategorie.' });
  }

  const state = first(input.bundesland) ?? first(input.state);
  if (state) {
    if (stateBySlug(state)) query.state = state;
    else issues.push({ param: 'bundesland', message: 'Unbekanntes Bundesland.' });
  }

  const postalCode = first(input.plz);
  if (postalCode) {
    if (isAustrianPostalCode(postalCode)) query.postalCode = postalCode;
    else issues.push({ param: 'plz', message: 'Bitte gib eine gültige österreichische Postleitzahl ein.' });
  }

  const locationId = first(input.ort);
  if (locationId) {
    if (/^\d{1,9}$/.test(locationId) && Number(locationId) > 0) query.locationId = Number(locationId);
    else issues.push({ param: 'ort', message: 'Unbekannter Ort.' });
  }

  const radius = first(input.umkreis);
  if (radius) {
    const km = Number(radius);
    if ((SEARCH_RADII as readonly number[]).includes(km)) query.radiusKm = km as SearchRadius;
    else issues.push({ param: 'umkreis', message: `Umkreis muss einer dieser Werte sein: ${SEARCH_RADII.join(', ')} km.` });
  }
  if (query.radiusKm && !query.locationId && !query.postalCode) {
    issues.push({ param: 'umkreis', message: 'Für die Umkreissuche bitte einen Ort oder eine PLZ angeben.' });
    delete query.radiusKm;
  }

  query.priceMin = parseNumber(first(input.preis_ab), 'preis_ab', issues, { min: 0, max: MAX_PRICE_EUR, decimals: 2 });
  query.priceMax = parseNumber(first(input.preis_bis), 'preis_bis', issues, { min: 0, max: MAX_PRICE_EUR, decimals: 2 });
  if (query.priceMin !== undefined && query.priceMax !== undefined && query.priceMin > query.priceMax) {
    [query.priceMin, query.priceMax] = [query.priceMax, query.priceMin];
  }

  const seller = first(input.anbieter);
  if (seller) {
    if (seller in SELLER_TYPES) query.seller = seller as SellerType;
    else issues.push({ param: 'anbieter', message: 'Anbieter muss „privat“ oder „gewerblich“ sein.' });
  }

  const conditions = list(input.zustand);
  if (conditions.length) {
    const valid = ITEM_CONDITIONS.filter((c) => conditions.includes(CONDITION_PARAMS[c]));
    if (valid.length !== conditions.length) issues.push({ param: 'zustand', message: 'Unbekannter Zustand.' });
    if (valid.length) query.conditions = valid;
  }

  for (const filter of filters) {
    const value = parseAttributeFilter(filter, input, issues);
    if (value) query.attributes[filter.key] = value;
  }

  const sort = first(input.sortierung);
  query.sort = query.q ? 'relevanz' : 'neueste';
  if (sort) {
    if (!(SEARCH_SORTS as readonly string[]).includes(sort)) issues.push({ param: 'sortierung', message: 'Unbekannte Sortierung.' });
    else if (sort === 'relevanz' && !query.q) query.sort = 'neueste';
    else if (sort === 'entfernung' && !query.locationId && !query.postalCode) query.sort = query.q ? 'relevanz' : 'neueste';
    else query.sort = sort as SearchSort;
  }

  const page = first(input.seite) ?? first(input.page);
  if (page) {
    const n = Number(page);
    if (Number.isInteger(n) && n >= 1 && n <= MAX_SEARCH_PAGE) query.page = n;
    else issues.push({ param: 'seite', message: `Seite muss zwischen 1 und ${MAX_SEARCH_PAGE} liegen.` });
  }
  const pageSize = first(input.pageSize);
  if (pageSize) {
    const n = Number(pageSize);
    if (Number.isInteger(n) && n >= 1 && n <= 50) query.pageSize = n;
    else issues.push({ param: 'pageSize', message: 'pageSize muss zwischen 1 und 50 liegen.' });
  }
  return { query, issues };
}

function parseAttributeFilter(filter: SearchFilter, input: RawSearchParams, issues: SearchParamIssue[]): AttributeFilterValue | null {
  switch (filter.kind) {
    case 'options': {
      const values = list(input[filter.param]);
      if (!values.length) return null;
      const valid = filter.options.filter((o) => values.includes(o.value)).map((o) => o.value);
      if (valid.length !== values.length) issues.push({ param: filter.param, message: `Unbekannter Wert bei „${filter.label}“.` });
      return valid.length ? { values: valid } : null;
    }
    case 'range': {
      const opts = { min: 0, max: filter.max * 10, decimals: filter.decimals };
      let min = parseNumber(first(input[`${filter.param}_ab`]), `${filter.param}_ab`, issues, opts);
      let max = parseNumber(first(input[`${filter.param}_bis`]), `${filter.param}_bis`, issues, opts);
      if (min === undefined && max === undefined) return null;
      if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
      return { ...(min !== undefined && { min }), ...(max !== undefined && { max }) };
    }
    case 'words': {
      const text = first(input[filter.param]);
      if (!text) return null;
      if (text.length > 60) {
        issues.push({ param: filter.param, message: `„${filter.label}“ darf höchstens 60 Zeichen lang sein.` });
        return null;
      }
      const words = filterWords(text);
      return words.length ? { words } : null;
    }
    case 'flag': {
      const value = first(input[filter.param]);
      if (!value) return null;
      if (value === 'ja' || value === 'true' || value === '1') return { flag: true };
      issues.push({ param: filter.param, message: `„${filter.label}“ erwartet „ja“.` });
      return null;
    }
  }
}

const formatNumber = (n: number) => String(n);

/**
 * Kanonische URL-Parameter einer Suche (für Links, Seitenwechsel, Entfernen einzelner Filter),
 * z. B. `new URLSearchParams(toSearchParams(query, filters))`.
 * Standardwerte (Seite 1, Standardsortierung) werden weggelassen.
 */
export function toSearchParams(query: SearchQuery, filters: readonly SearchFilter[] = []): Record<string, string> {
  const params: Record<string, string> = {};
  const set = (key: string, value: string) => {
    params[key] = value;
  };
  if (query.q) set('q', query.q);
  if (query.vertical && !(query.category && isCategoryPath(query.category))) set('bereich', VERTICAL_SLUGS[query.vertical]);
  if (query.category) set('kategorie', query.category);
  if (query.state) set('bundesland', query.state);
  if (query.locationId) set('ort', String(query.locationId));
  else if (query.postalCode) set('plz', query.postalCode);
  if (query.radiusKm && (query.locationId || query.postalCode)) set('umkreis', String(query.radiusKm));
  if (query.priceMin !== undefined) set('preis_ab', formatNumber(query.priceMin));
  if (query.priceMax !== undefined) set('preis_bis', formatNumber(query.priceMax));
  if (query.seller) set('anbieter', query.seller);
  if (query.conditions?.length) set('zustand', query.conditions.map((c) => CONDITION_PARAMS[c]).join(','));
  for (const filter of filters) {
    const value = query.attributes[filter.key];
    if (!value) continue;
    if (value.values?.length) set(filter.param, value.values.join(','));
    if (value.min !== undefined) set(`${filter.param}_ab`, formatNumber(value.min));
    if (value.max !== undefined) set(`${filter.param}_bis`, formatNumber(value.max));
    if (value.words?.length) set(filter.param, value.words.join(' '));
    if (value.flag) set(filter.param, 'ja');
  }
  const defaultSort = query.q ? 'relevanz' : 'neueste';
  if (query.sort !== defaultSort) set('sortierung', query.sort);
  if (query.page > 1) set('seite', String(query.page));
  if (query.pageSize !== SEARCH_PAGE_SIZE) set('pageSize', String(query.pageSize));
  return params;
}

/** Ob überhaupt etwas eingeschränkt ist (für „Alle zurücksetzen“ und Leermeldungen). */
export function hasActiveFilters(query: SearchQuery): boolean {
  return Boolean(
    query.q || query.vertical || query.category || query.state || query.postalCode || query.locationId ||
      query.priceMin !== undefined || query.priceMax !== undefined || query.seller || query.conditions?.length ||
      Object.keys(query.attributes).length,
  );
}
