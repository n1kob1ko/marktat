/** Hilfen für die Listen im Admin-Bereich (Filter stehen in der URL, damit Links teilbar sind). */

export type SearchParams = Record<string, string | string[] | undefined>;

/** Erster Wert eines Query-Parameters */
export function param(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
}

/** Nur bekannte Filter weitergeben (nie beliebige Parameter an die API durchreichen) */
export function pick(params: SearchParams, keys: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = param(params, key);
    if (value) result[key] = value;
  }
  return result;
}

export function withQuery(path: string, query: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '' && !(key === 'page' && Number(value) === 1)) search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

export function totalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** IDs aus Formularen, bevor sie in API-Pfade eingesetzt werden */
export const ENTITY_ID = /^[a-z0-9]{20,40}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
