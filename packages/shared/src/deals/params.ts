/**
 * Suchparameter der Deals – gleiche Namen in der URL der Website (/deals?…) und in `GET /v1/deals`, z. B.
 *   /deals?kategorie=elektronik-computer&kanal=lokal&plz=1010&umkreis=10&rabatt_ab=20
 */
import { isAustrianPostalCode, stateBySlug } from '../austria.js';
import { parseLocaleNumber } from '../attributes/validation.js';
import { MAX_SEARCH_PAGE, SEARCH_RADII, type RawSearchParams, type SearchParamIssue, type SearchRadius } from '../search/params.js';
import { dealCategoryBySlug } from './categories.js';

export const DEAL_SORTS = ['relevanz', 'neueste', 'endet_bald', 'rabatt', 'preis_auf', 'preis_ab', 'entfernung'] as const;
export type DealSort = (typeof DEAL_SORTS)[number];

export const DEAL_SORT_LABELS: Record<DealSort, string> = {
  relevanz: 'Beste Treffer',
  neueste: 'Neueste zuerst',
  endet_bald: 'Endet bald',
  rabatt: 'Höchster Rabatt',
  preis_auf: 'Preis aufsteigend',
  preis_ab: 'Preis absteigend',
  entfernung: 'Entfernung',
};

/** Online: auch Angebote, die online und im Geschäft gelten; lokal ebenso */
export const DEAL_CHANNEL_PARAMS = { online: 'Online', lokal: 'Lokal im Geschäft' } as const;
export type DealChannelParam = keyof typeof DEAL_CHANNEL_PARAMS;

/** Auswahl für „Rabatt ab“ */
export const DEAL_DISCOUNT_STEPS = [10, 20, 30, 50] as const;

export const DEAL_PAGE_SIZE = 24;
const MAX_PRICE_EUR = 1_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DealSearchQuery {
  q?: string;
  /** Slug der Deal-Kategorie */
  category?: string;
  /** Händler (Konto-ID) */
  merchantId?: string;
  channel?: DealChannelParam;
  state?: string;
  postalCode?: string;
  locationId?: number;
  radiusKm?: SearchRadius;
  /** Euro */
  priceMin?: number;
  priceMax?: number;
  /** Mindestrabatt in Prozent (nur Deals mit zulässigem Vergleichspreis) */
  discountMin?: number;
  sort: DealSort;
  page: number;
  pageSize: number;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() || undefined;

function parseAmount(raw: string | undefined, param: string, issues: SearchParamIssue[], max: number) {
  if (raw === undefined) return undefined;
  const value = parseLocaleNumber(raw);
  if (value === null || value < 0 || value > max) {
    issues.push({ param, message: `„${param}“ muss eine Zahl zwischen 0 und ${max} sein.` });
    return undefined;
  }
  return Math.round(value * 100) / 100;
}

/** Ungültige Werte werden als `issues` gemeldet: Die Website ignoriert sie, die API antwortet mit 400. */
export function parseDealSearchParams(input: RawSearchParams): { query: DealSearchQuery; issues: SearchParamIssue[] } {
  const issues: SearchParamIssue[] = [];
  const query: DealSearchQuery = { sort: 'neueste', page: 1, pageSize: DEAL_PAGE_SIZE };

  const q = first(input.q);
  if (q) {
    if (q.length > 100) issues.push({ param: 'q', message: 'Der Suchbegriff darf höchstens 100 Zeichen lang sein.' });
    else query.q = q.replace(/\s+/g, ' ');
  }
  const category = first(input.kategorie);
  if (category) {
    if (dealCategoryBySlug(category)) query.category = category;
    else issues.push({ param: 'kategorie', message: 'Unbekannte Kategorie.' });
  }
  const merchant = first(input.haendler);
  if (merchant) {
    if (UUID.test(merchant)) query.merchantId = merchant.toLowerCase();
    else issues.push({ param: 'haendler', message: 'Unbekannter Händler.' });
  }
  const channel = first(input.kanal);
  if (channel) {
    if (channel in DEAL_CHANNEL_PARAMS) query.channel = channel as DealChannelParam;
    else issues.push({ param: 'kanal', message: 'Kanal muss „online“ oder „lokal“ sein.' });
  }
  const state = first(input.bundesland);
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
  query.priceMin = parseAmount(first(input.preis_ab), 'preis_ab', issues, MAX_PRICE_EUR);
  query.priceMax = parseAmount(first(input.preis_bis), 'preis_bis', issues, MAX_PRICE_EUR);
  if (query.priceMin !== undefined && query.priceMax !== undefined && query.priceMin > query.priceMax) {
    [query.priceMin, query.priceMax] = [query.priceMax, query.priceMin];
  }
  const discount = first(input.rabatt_ab);
  if (discount) {
    const n = Number(discount);
    if (Number.isInteger(n) && n >= 1 && n <= 99) query.discountMin = n;
    else issues.push({ param: 'rabatt_ab', message: 'Rabatt ab muss eine ganze Zahl zwischen 1 und 99 sein.' });
  }

  const hasCenter = Boolean(query.locationId || query.postalCode);
  query.sort = query.q ? 'relevanz' : 'neueste';
  const sort = first(input.sortierung);
  if (sort) {
    if (!(DEAL_SORTS as readonly string[]).includes(sort)) issues.push({ param: 'sortierung', message: 'Unbekannte Sortierung.' });
    else if (sort === 'relevanz' && !query.q) query.sort = 'neueste';
    else if (sort === 'entfernung' && !hasCenter) query.sort = query.q ? 'relevanz' : 'neueste';
    else query.sort = sort as DealSort;
  }
  const page = first(input.seite);
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

/** Kanonische URL-Parameter (Standardwerte weggelassen) */
export function toDealSearchParams(query: DealSearchQuery): Record<string, string> {
  const params: Record<string, string> = {};
  if (query.q) params.q = query.q;
  if (query.category) params.kategorie = query.category;
  if (query.merchantId) params.haendler = query.merchantId;
  if (query.channel) params.kanal = query.channel;
  if (query.state) params.bundesland = query.state;
  if (query.locationId) params.ort = String(query.locationId);
  else if (query.postalCode) params.plz = query.postalCode;
  if (query.radiusKm && (query.locationId || query.postalCode)) params.umkreis = String(query.radiusKm);
  if (query.priceMin !== undefined) params.preis_ab = String(query.priceMin);
  if (query.priceMax !== undefined) params.preis_bis = String(query.priceMax);
  if (query.discountMin !== undefined) params.rabatt_ab = String(query.discountMin);
  if (query.sort !== (query.q ? 'relevanz' : 'neueste')) params.sortierung = query.sort;
  if (query.page > 1) params.seite = String(query.page);
  if (query.pageSize !== DEAL_PAGE_SIZE) params.pageSize = String(query.pageSize);
  return params;
}

export function dealSearchHref(query: DealSearchQuery): string {
  const params = new URLSearchParams(toDealSearchParams(query));
  params.delete('pageSize');
  const text = params.toString();
  return text ? `/deals?${text}` : '/deals';
}

export function hasActiveDealFilters(query: DealSearchQuery): boolean {
  return Boolean(
    query.q || query.category || query.merchantId || query.channel || query.state || query.postalCode || query.locationId ||
      query.priceMin !== undefined || query.priceMax !== undefined || query.discountMin !== undefined,
  );
}
