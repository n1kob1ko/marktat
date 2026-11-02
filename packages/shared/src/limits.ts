/** Höchstlänge einer Nachricht (Zeichen). Gleicher Wert in der Datenbank (VARCHAR). */
export const MESSAGE_MAX_LENGTH = 2000;
/** Höchstzahl gespeicherter Suchen je Konto */
export const MAX_SAVED_SEARCHES = 50;
/** Höchstzahl gemerkter Inserate je Konto */
export const MAX_FAVORITES = 500;

/** Erst ab so vielen vergleichbaren Inseraten wird eine Preisspanne gezeigt (sonst verrät sie einzelne Preise). */
export const PRICE_HINT_MIN_LISTINGS = 3;
/** Umkreis für den Preisvorschlag „in der Nähe“ */
export const PRICE_HINT_RADIUS_KM = 50;

/**
 * Administratorkonten haben keine Mengen- und Zeitlimits (Rate-Limits, Höchstzahlen je Konto, Tageslimits).
 * Technische Grenzen wie Dateigröße, Textlänge oder Fotos je Inserat gelten weiter für alle.
 */
export function isUnlimitedAccount(user: { role?: string | null } | null | undefined): boolean {
  return user?.role === 'ADMIN';
}
