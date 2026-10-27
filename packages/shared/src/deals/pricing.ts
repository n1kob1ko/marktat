import type { ReferencePriceType } from './enums.js';

/** Höchstlaufzeit eines Deals (Beginn bis Ende); danach muss der Händler ihn neu anlegen bzw. verlängern. */
export const DEAL_MAX_DURATION_DAYS = 90;
/**
 * Ohne Bestätigung durch den Händler (Bearbeiten, „Angebot bestätigen“, Import oder Feed) gilt ein Deal nach
 * so vielen Tagen als nicht mehr geprüft und wird nicht mehr als aktuell angezeigt.
 */
export const DEAL_VERIFY_DAYS = 14;
/** Ab diesem Rabatt prüft das Team den Vergleichspreis, bevor der Deal erscheint. */
export const DEAL_DISCOUNT_REVIEW_PERCENT = 70;
/** Höchstpreis eines Deals: 1 Mio. Euro in Cent */
export const DEAL_MAX_PRICE_CENTS = 100_000_000;

/**
 * Rabatt in ganzen Prozent – nur mit einer zulässigen, nachvollziehbaren Grundlage (Vergleichspreis mit Art),
 * abgerundet, damit er nie größer erscheint als er ist. Unter 1 % gibt es keine Rabattangabe.
 */
export function dealDiscountPercent(
  priceCents: number,
  referencePriceCents: number | null | undefined,
  referencePriceType: ReferencePriceType | null | undefined,
): number | null {
  if (!referencePriceType || !referencePriceCents || referencePriceCents <= priceCents || priceCents <= 0) return null;
  const percent = Math.floor(((referencePriceCents - priceCents) * 100) / referencePriceCents);
  return percent >= 1 ? percent : null;
}

/** Ersparnis in Cent (nur mit zulässiger Grundlage) */
export function dealSavingsCents(
  priceCents: number,
  referencePriceCents: number | null | undefined,
  referencePriceType: ReferencePriceType | null | undefined,
): number | null {
  return dealDiscountPercent(priceCents, referencePriceCents, referencePriceType) === null ? null : referencePriceCents! - priceCents;
}

/** Niedrigster tatsächlich erfasster Preis vor `before` innerhalb von 30 Tagen (eigene Aufzeichnung von MarktAT). */
export function lowestRecordedPrice(records: readonly { priceCents: number; recordedAt: string | Date }[], before: Date, days = 30): number | null {
  const from = before.getTime() - days * 86_400_000;
  let lowest: number | null = null;
  for (const record of records) {
    const at = new Date(record.recordedAt).getTime();
    if (at < from || at >= before.getTime()) continue;
    if (lowest === null || record.priceCents < lowest) lowest = record.priceCents;
  }
  return lowest;
}
