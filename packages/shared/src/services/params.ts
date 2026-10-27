/**
 * Suchparameter der Anbieter – gleiche Namen in der URL (/dienstleistungen?…) und in `GET /v1/services`, z. B.
 *   /dienstleistungen?bereich=it-digital&kategorie=webentwicklung&plz=8010&umkreis=25&remote=ja
 */
import { isAustrianPostalCode } from '../austria.js';
import { parseLocaleNumber } from '../attributes/validation.js';
import { MAX_SEARCH_PAGE, SEARCH_RADII, type RawSearchParams, type SearchParamIssue, type SearchRadius } from '../search/params.js';
import { serviceCategoryBySlug, serviceGroupBySlug } from './categories.js';

export const SERVICE_SORTS = ['relevanz', 'neueste', 'preis_auf', 'entfernung'] as const;
export type ServiceSort = (typeof SERVICE_SORTS)[number];
export const SERVICE_SORT_LABELS: Record<ServiceSort, string> = {
  relevanz: 'Beste Treffer',
  neueste: 'Zuletzt aktualisiert',
  preis_auf: 'Preis aufsteigend',
  entfernung: 'Entfernung',
};

export const SERVICE_PROVIDER_TYPES = { privat: 'Privatperson', gewerblich: 'Unternehmen' } as const;
export type ServiceProviderTypeParam = keyof typeof SERVICE_PROVIDER_TYPES;

export const SERVICE_PAGE_SIZE = 20;
const MAX_PRICE_EUR = 100_000;

export interface ServiceSearchQuery {
  q?: string;
  group?: string;
  category?: string;
  postalCode?: string;
  locationId?: number;
  radiusKm?: SearchRadius;
  /** Nur Anbieter, die remote arbeiten */
  remote?: boolean;
  /** Höchstpreis in Euro (Stundensatz bzw. Pauschale); „auf Anfrage“ wird dann ausgeblendet */
  priceMax?: number;
  /** Nur derzeit verfügbare Anbieter (verfügbar oder eingeschränkt) */
  available?: boolean;
  providerType?: ServiceProviderTypeParam;
  sort: ServiceSort;
  page: number;
  pageSize: number;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
const yes = (value: string | undefined) => value === 'ja' || value === '1' || value === 'true';

export function parseServiceSearchParams(input: RawSearchParams): { query: ServiceSearchQuery; issues: SearchParamIssue[] } {
  const issues: SearchParamIssue[] = [];
  const query: ServiceSearchQuery = { sort: 'neueste', page: 1, pageSize: SERVICE_PAGE_SIZE };
  const q = first(input.q);
  if (q) {
    if (q.length > 100) issues.push({ param: 'q', message: 'Der Suchbegriff darf höchstens 100 Zeichen lang sein.' });
    else query.q = q.replace(/\s+/g, ' ');
  }
  const group = first(input.bereich);
  if (group) {
    if (serviceGroupBySlug(group)) query.group = group;
    else issues.push({ param: 'bereich', message: 'Unbekannter Bereich.' });
  }
  const category = first(input.kategorie);
  if (category) {
    const found = serviceCategoryBySlug(category);
    if (found) {
      query.category = category;
      query.group = found.group.slug;
    } else issues.push({ param: 'kategorie', message: 'Unbekannte Kategorie.' });
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
  if (yes(first(input.remote))) query.remote = true;
  if (yes(first(input.verfuegbar))) query.available = true;
  const price = first(input.preis_bis);
  if (price !== undefined) {
    const value = parseLocaleNumber(price);
    if (value === null || value <= 0 || value > MAX_PRICE_EUR) issues.push({ param: 'preis_bis', message: `„preis_bis“ muss eine Zahl zwischen 1 und ${MAX_PRICE_EUR} sein.` });
    else query.priceMax = Math.round(value * 100) / 100;
  }
  const provider = first(input.anbieter);
  if (provider) {
    if (provider in SERVICE_PROVIDER_TYPES) query.providerType = provider as ServiceProviderTypeParam;
    else issues.push({ param: 'anbieter', message: 'Anbieter muss „privat“ oder „gewerblich“ sein.' });
  }
  const hasCenter = Boolean(query.locationId || query.postalCode);
  query.sort = query.q ? 'relevanz' : 'neueste';
  const sort = first(input.sortierung);
  if (sort) {
    if (!(SERVICE_SORTS as readonly string[]).includes(sort)) issues.push({ param: 'sortierung', message: 'Unbekannte Sortierung.' });
    else if (sort === 'relevanz' && !query.q) query.sort = 'neueste';
    else if (sort === 'entfernung' && !hasCenter) query.sort = query.q ? 'relevanz' : 'neueste';
    else query.sort = sort as ServiceSort;
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

export function toServiceSearchParams(query: ServiceSearchQuery): Record<string, string> {
  const params: Record<string, string> = {};
  if (query.q) params.q = query.q;
  if (query.category) params.kategorie = query.category;
  else if (query.group) params.bereich = query.group;
  if (query.locationId) params.ort = String(query.locationId);
  else if (query.postalCode) params.plz = query.postalCode;
  if (query.radiusKm && (query.locationId || query.postalCode)) params.umkreis = String(query.radiusKm);
  if (query.remote) params.remote = 'ja';
  if (query.available) params.verfuegbar = 'ja';
  if (query.priceMax !== undefined) params.preis_bis = String(query.priceMax);
  if (query.providerType) params.anbieter = query.providerType;
  if (query.sort !== (query.q ? 'relevanz' : 'neueste')) params.sortierung = query.sort;
  if (query.page > 1) params.seite = String(query.page);
  if (query.pageSize !== SERVICE_PAGE_SIZE) params.pageSize = String(query.pageSize);
  return params;
}

export function serviceSearchHref(query: ServiceSearchQuery, base = '/dienstleistungen'): string {
  const params = new URLSearchParams(toServiceSearchParams(query));
  params.delete('pageSize');
  const text = params.toString();
  return text ? `${base}?${text}` : base;
}

export function hasActiveServiceFilters(query: ServiceSearchQuery): boolean {
  return Boolean(
    query.q || query.group || query.category || query.postalCode || query.locationId || query.remote || query.available ||
      query.priceMax !== undefined || query.providerType,
  );
}
