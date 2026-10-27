import {
  DEAL_CHANNEL_PARAMS,
  REFERENCE_PRICE_LABELS,
  dealCategoryBySlug,
  dealSearchHref,
  formatDate,
  formatPriceCents,
  stateBySlug,
  type DealDetail,
  type DealSearchQuery,
  type DealSummary,
  type LocationSummary,
} from '@marktat/shared';

const DAY_MS = 86_400_000;

/** „gültig bis 12.11.2026“ bzw. „ab 01.11.2026 bis …“ – Enddatum in Wiener Zeit (Ende des letzten Tages) */
export function dealValidity(deal: Pick<DealSummary, 'startsAt' | 'endsAt'>, now = new Date()): string {
  const end = formatDate(deal.endsAt);
  if (new Date(deal.startsAt) > now) return `gültig ${formatDate(deal.startsAt)} bis ${end}`;
  return `gültig bis ${end}`;
}

/** Endet innerhalb von 48 Stunden (sachlicher Hinweis, kein Countdown) */
export function endsSoon(deal: Pick<DealSummary, 'endsAt'>, now = new Date()): boolean {
  const left = new Date(deal.endsAt).getTime() - now.getTime();
  return left > 0 && left < 2 * DAY_MS;
}

/** Erklärung des Vergleichspreises, z. B. für die Detailseite */
export function referenceExplanation(deal: Pick<DealDetail, 'referencePriceCents' | 'referencePriceType' | 'referencePriceSource' | 'discountPercent'>): string | null {
  if (!deal.referencePriceCents || !deal.referencePriceType || deal.discountPercent === null) return null;
  const base = `${formatPriceCents(deal.referencePriceCents)}: ${REFERENCE_PRICE_LABELS[deal.referencePriceType]}`;
  return deal.referencePriceSource ? `${base} – Quelle laut Händler: ${deal.referencePriceSource}` : base;
}

export interface DealChip {
  id: string;
  label: string;
  removeHref: string;
}

/** Aktive Filter als entfernbare Chips */
export function dealChips(query: DealSearchQuery, location: LocationSummary | null, merchantName?: string): DealChip[] {
  const chips: DealChip[] = [];
  const without = (change: Partial<DealSearchQuery>) => dealSearchHref({ ...query, ...change, page: 1 });
  if (query.category) chips.push({ id: 'kategorie', label: dealCategoryBySlug(query.category)?.name ?? query.category, removeHref: without({ category: undefined }) });
  if (query.channel) chips.push({ id: 'kanal', label: DEAL_CHANNEL_PARAMS[query.channel], removeHref: without({ channel: undefined }) });
  if (query.merchantId) chips.push({ id: 'haendler', label: merchantName ?? 'Händler', removeHref: without({ merchantId: undefined }) });
  if (query.locationId || query.postalCode) {
    const where = location ? `${location.postalCode} ${location.place}` : (query.postalCode ?? 'Ort');
    chips.push({
      id: 'ort',
      label: query.radiusKm ? `${where} + ${query.radiusKm} km` : where,
      removeHref: without({ locationId: undefined, postalCode: undefined, radiusKm: undefined, sort: query.sort === 'entfernung' ? 'neueste' : query.sort }),
    });
  }
  if (query.state) chips.push({ id: 'bundesland', label: stateBySlug(query.state)?.name ?? query.state, removeHref: without({ state: undefined }) });
  if (query.priceMin !== undefined || query.priceMax !== undefined) {
    const label =
      query.priceMin !== undefined && query.priceMax !== undefined
        ? `€ ${query.priceMin.toLocaleString('de-AT')} – ${query.priceMax.toLocaleString('de-AT')}`
        : query.priceMin !== undefined
          ? `ab € ${query.priceMin.toLocaleString('de-AT')}`
          : `bis € ${query.priceMax!.toLocaleString('de-AT')}`;
    chips.push({ id: 'preis', label, removeHref: without({ priceMin: undefined, priceMax: undefined }) });
  }
  if (query.discountMin !== undefined) chips.push({ id: 'rabatt', label: `ab ${query.discountMin} % Rabatt`, removeHref: without({ discountMin: undefined }) });
  return chips;
}
