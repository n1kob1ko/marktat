import {
  SERVICE_PROVIDER_TYPES,
  formatPriceCents,
  serviceCategoryBySlug,
  serviceGroupBySlug,
  serviceSearchHref,
  type LocationSummary,
  type ServiceProfileSummary,
  type ServiceSearchQuery,
} from '@marktat/shared';

/** „€ 65 / Stunde“, „ab € 120 pauschal“ oder „Preis auf Anfrage“ */
export function servicePriceLabel(profile: Pick<ServiceProfileSummary, 'priceType' | 'priceCents'>): string {
  if (profile.priceType === 'ON_REQUEST' || profile.priceCents === null) return 'Preis auf Anfrage';
  const price = formatPriceCents(profile.priceCents);
  return profile.priceType === 'HOURLY' ? `${price} / Stunde` : `ab ${price} pauschal`;
}

/** Einsatzgebiet in einer Zeile, z. B. „8010 Graz + 30 km · auch remote“ */
export function serviceAreaLabel(profile: Pick<ServiceProfileSummary, 'location' | 'serviceRadiusKm' | 'austriaWide' | 'remote'>): string {
  const parts: string[] = [];
  if (profile.austriaWide) parts.push('Österreichweit');
  else if (profile.location) parts.push(`${profile.location.postalCode} ${profile.location.place}${profile.serviceRadiusKm ? ` + ${profile.serviceRadiusKm} km` : ''}`);
  if (profile.remote) parts.push(parts.length ? 'auch remote' : 'Remote');
  return parts.join(' · ');
}

export interface ServiceChip {
  id: string;
  label: string;
  removeHref: string;
}

/** Aktive Filter als entfernbare Chips */
export function serviceChips(query: ServiceSearchQuery, location: LocationSummary | null): ServiceChip[] {
  const chips: ServiceChip[] = [];
  const without = (change: Partial<ServiceSearchQuery>) => serviceSearchHref({ ...query, ...change, page: 1 });
  if (query.category) {
    chips.push({ id: 'kategorie', label: serviceCategoryBySlug(query.category)?.name ?? query.category, removeHref: without({ category: undefined }) });
  } else if (query.group) {
    chips.push({ id: 'bereich', label: serviceGroupBySlug(query.group)?.name ?? query.group, removeHref: without({ group: undefined }) });
  }
  if (query.locationId || query.postalCode) {
    const where = location ? `${location.postalCode} ${location.place}` : (query.postalCode ?? 'Ort');
    chips.push({
      id: 'ort',
      label: query.radiusKm ? `${where} + ${query.radiusKm} km` : where,
      removeHref: without({ locationId: undefined, postalCode: undefined, radiusKm: undefined, sort: query.sort === 'entfernung' ? 'neueste' : query.sort }),
    });
  }
  if (query.remote) chips.push({ id: 'remote', label: 'Remote möglich', removeHref: without({ remote: undefined }) });
  if (query.available) chips.push({ id: 'verfuegbar', label: 'Derzeit verfügbar', removeHref: without({ available: undefined }) });
  if (query.priceMax !== undefined) chips.push({ id: 'preis', label: `bis € ${query.priceMax.toLocaleString('de-AT')}`, removeHref: without({ priceMax: undefined }) });
  if (query.providerType) chips.push({ id: 'anbieter', label: SERVICE_PROVIDER_TYPES[query.providerType], removeHref: without({ providerType: undefined }) });
  return chips;
}
