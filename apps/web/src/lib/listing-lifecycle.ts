/** „Verlängern“ wird angeboten, sobald eine aktive Anzeige in weniger als so vielen Tagen abläuft */
export const RENEW_WINDOW_DAYS = 7;
export const RENEW_WINDOW_MS = RENEW_WINDOW_DAYS * 86_400_000;
/** So lange bleibt eine verkaufte Anzeige als „Verkauft“-Seite erreichbar (entspricht SOLD_PUBLIC_DAYS in der API) */
export const SOLD_PUBLIC_DAYS = 30;

/** Läuft eine aktive Anzeige demnächst ab? (Zeitpunkt der Prüfung = Rendern der Seite) */
export function expiresSoon(listing: { status: string; expiresAt: string | null }, now = Date.now()) {
  return listing.status === 'ACTIVE' && listing.expiresAt !== null && Date.parse(listing.expiresAt) - now < RENEW_WINDOW_MS;
}
