/**
 * Österreichische Bundesländer mit ISO-3166-2-Codes.
 * Bezirke und Postleitzahlen liegen in der Datenbank (siehe apps/api/prisma/seed).
 */
export const STATES = [
  { code: 'AT-1', slug: 'burgenland', name: 'Burgenland' },
  { code: 'AT-2', slug: 'kaernten', name: 'Kärnten' },
  { code: 'AT-3', slug: 'niederoesterreich', name: 'Niederösterreich' },
  { code: 'AT-4', slug: 'oberoesterreich', name: 'Oberösterreich' },
  { code: 'AT-5', slug: 'salzburg', name: 'Salzburg' },
  { code: 'AT-6', slug: 'steiermark', name: 'Steiermark' },
  { code: 'AT-7', slug: 'tirol', name: 'Tirol' },
  { code: 'AT-8', slug: 'vorarlberg', name: 'Vorarlberg' },
  { code: 'AT-9', slug: 'wien', name: 'Wien' },
] as const;

export type StateCode = (typeof STATES)[number]['code'];
export type StateSlug = (typeof STATES)[number]['slug'];

/** Österreichische Postleitzahlen sind vierstellig und beginnen nicht mit 0. */
export const POSTAL_CODE_REGEX = /^[1-9]\d{3}$/;

export function isAustrianPostalCode(value: string): boolean {
  return POSTAL_CODE_REGEX.test(value.trim());
}

export function stateBySlug(slug: string) {
  return STATES.find((s) => s.slug === slug);
}
