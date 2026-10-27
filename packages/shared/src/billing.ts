/**
 * Monetarisierung (Phase 7): Leistungen, Preise und Betriebsmodus.
 *
 * Grundregel: Verrechnet wird nur, wenn ALLE Bedingungen erfüllt sind – Betriebsmodus PAID (ausdrücklich von
 * einem Admin eingeschaltet), Leistung für den kostenpflichtigen Betrieb freigegeben, kein Aktionszeitraum und
 * ein Preis über 0. Kein Datum (Ende einer Aktion oder Einführungsphase) schaltet Gebühren automatisch ein.
 * Maßgeblich ist immer die Berechnung auf dem Server; das Web zeigt nur an.
 */

export const PRODUCT_KINDS = ['LISTING', 'HIGHLIGHT', 'TOP_AD', 'BUMP'] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

/** Produktkennungen der Startkonfiguration (Migration 20261028090000_monetization) */
export const PRODUCT_CODES = ['listing', 'highlight', 'top', 'bump'] as const;
export type ProductCode = (typeof PRODUCT_CODES)[number];

/** Direkt buchbare Zusatzleistungen; das Inserat selbst wird über „Veröffentlichen“ gebucht. */
export const PROMOTION_CODES = ['highlight', 'top', 'bump'] as const satisfies readonly ProductCode[];
export type PromotionCode = (typeof PROMOTION_CODES)[number];

export const BILLING_MODES = ['FREE', 'PAID'] as const;
export type BillingMode = (typeof BILLING_MODES)[number];
export const BILLING_MODE_LABELS: Record<BillingMode, string> = {
  FREE: 'Kostenloser Plattformbetrieb',
  PAID: 'Kostenpflichtiger Plattformbetrieb',
};

/** Muss beim Einschalten des kostenpflichtigen Betriebs wörtlich eingegeben werden. */
export const PAID_MODE_CONFIRMATION = 'KOSTENPFLICHTIG';

export const BOOKING_STATUSES = ['PENDING_PAYMENT', 'ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'REFUNDED'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING_PAYMENT: 'Wartet auf Zahlung',
  ACTIVE: 'Aktiv',
  COMPLETED: 'Ausgeführt',
  EXPIRED: 'Abgelaufen',
  CANCELLED: 'Abgebrochen',
  REFUNDED: 'Erstattet',
};

export const PAYMENT_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: 'Offen',
  SUCCEEDED: 'Bezahlt',
  FAILED: 'Fehlgeschlagen',
  CANCELLED: 'Abgebrochen',
  EXPIRED: 'Abgelaufen',
  REFUNDED: 'Erstattet',
  PARTIALLY_REFUNDED: 'Teilweise erstattet',
};

export const PRODUCT_KIND_LABELS: Record<ProductKind, string> = {
  LISTING: 'Inserat',
  HIGHLIGHT: 'Hervorhebung',
  TOP_AD: 'Top-Anzeige',
  BUMP: 'Hochschieben',
};

/** Warum ein Preis gilt – für Anzeige und Protokoll */
export type PriceReason = 'free_mode' | 'not_paid' | 'promotion' | 'zero_price' | 'paid';
export const PRICE_REASON_LABELS: Record<PriceReason, string> = {
  free_mode: 'Kostenloser Plattformbetrieb',
  not_paid: 'Für den kostenpflichtigen Betrieb nicht freigegeben',
  promotion: 'Aktionszeitraum',
  zero_price: 'Preis 0,00 €',
  paid: 'Kostenpflichtig',
};

type DateLike = Date | string | null | undefined;

const toTime = (value: DateLike) => (value ? new Date(value).getTime() : null);

/** Liegt `now` im Zeitraum? Fehlender Beginn bzw. fehlendes Ende = offen. */
export function isWithinWindow(startsAt: DateLike, endsAt: DateLike, now: Date = new Date()): boolean {
  const start = toTime(startsAt);
  const end = toTime(endsAt);
  const t = now.getTime();
  return (start === null || start <= t) && (end === null || t < end);
}

export interface PricingInput {
  priceCents: number;
  paidEnabled: boolean;
  promoStartsAt?: DateLike;
  promoEndsAt?: DateLike;
}

export interface EffectivePrice {
  /** Tatsächlich zu zahlender Betrag in Cent */
  priceCents: number;
  reason: PriceReason;
  requiresPayment: boolean;
}

/** Der Aktionszeitraum gilt nur, wenn mindestens eine Grenze gesetzt ist. */
export function inPromotion(product: Pick<PricingInput, 'promoStartsAt' | 'promoEndsAt'>, now: Date = new Date()) {
  if (!product.promoStartsAt && !product.promoEndsAt) return false;
  return isWithinWindow(product.promoStartsAt, product.promoEndsAt, now);
}

/** Effektiver Preis einer Leistung zum Zeitpunkt `now`. */
export function effectivePrice(product: PricingInput, mode: BillingMode, now: Date = new Date()): EffectivePrice {
  const free = (reason: PriceReason): EffectivePrice => ({ priceCents: 0, reason, requiresPayment: false });
  if (mode !== 'PAID') return free('free_mode');
  if (!product.paidEnabled) return free('not_paid');
  if (inPromotion(product, now)) return free('promotion');
  if (!Number.isInteger(product.priceCents) || product.priceCents <= 0) return free('zero_price');
  return { priceCents: product.priceCents, reason: 'paid', requiresPayment: true };
}

export interface IntroSettings {
  introEnabled: boolean;
  introVisible: boolean;
  introTitle: string;
  introDescription: string;
  introStartsAt: DateLike;
  introEndsAt: DateLike;
  introShowPlannedPrice: boolean;
}

export interface IntroOffer {
  title: string;
  description: string;
  /** Nur wenn ein Enddatum festgelegt ist – sonst keine Befristung anzeigen */
  endsAt: string | null;
  /** Geplanter Standardpreis eines Inserats nach der Einführungsphase (nur wenn so eingestellt) */
  plannedPriceCents: number | null;
}

/**
 * Einführungsaktion für die Website. Erscheint nur, solange ein Inserat tatsächlich kostenlos ist – im
 * kostenpflichtigen Betrieb mit Preis wäre „kostenlos inserieren“ irreführend.
 */
export function introOffer(
  settings: IntroSettings,
  listingProduct: (PricingInput & { plannedPriceCents: number | null }) | null,
  mode: BillingMode,
  now: Date = new Date(),
): IntroOffer | null {
  if (!settings.introEnabled || !settings.introVisible) return null;
  if (!isWithinWindow(settings.introStartsAt, settings.introEndsAt, now)) return null;
  if (listingProduct && effectivePrice(listingProduct, mode, now).requiresPayment) return null;
  const planned = settings.introShowPlannedPrice ? (listingProduct?.plannedPriceCents ?? null) : null;
  return {
    title: settings.introTitle,
    description: settings.introDescription,
    endsAt: settings.introEndsAt ? new Date(settings.introEndsAt).toISOString() : null,
    plannedPriceCents: planned !== null && planned > 0 ? planned : null,
  };
}

const amountFormatter = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });

/** Betrag für Preise von Leistungen, immer mit Cent, z. B. „€ 0,00“ oder „€ 4,90“. */
export function formatAmountCents(cents: number): string {
  return amountFormatter.format(cents / 100);
}
