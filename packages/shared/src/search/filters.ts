/**
 * Suchfilter aus den Felddefinitionen der Kategorien (attributes/definitions.ts).
 * Es gibt keine eigene Filterkonfiguration: ein Feld wird zum Filter, sobald es `filter` trägt.
 */
import { ATTRIBUTE_RULE_PATHS, categoryAttributeSchema } from '../attributes/definitions.js';
import type { AttributeField, AttributeOption, ListingAttributes } from '../attributes/types.js';
import { VERTICAL_SLUGS } from '../enums.js';

interface FilterBase {
  /** Schlüssel in `listings.attributes` bzw. im Suchindex (`attributes.<key>`) */
  key: string;
  /** Name in der Such-URL */
  param: string;
  label: string;
}

/** Auswahl: `any` = eine der gewählten Optionen (Kraftstoff), `all` = alle gewählten (Ausstattung) */
export interface OptionsFilter extends FilterBase {
  kind: 'options';
  match: 'any' | 'all';
  options: AttributeOption[];
}

export interface RangeFilter extends FilterBase {
  kind: 'range';
  min: number;
  max: number;
  /** Erlaubte Nachkommastellen der Eingabe */
  decimals: number;
  unit?: string;
  /** Beträge in Euro (Gehalt) */
  euro?: boolean;
}

/** Freitext: Treffer enthalten alle eingegebenen Wörter (Modell „Golf TSI“) */
export interface WordsFilter extends FilterBase {
  kind: 'words';
  placeholder?: string;
}

/** Nur Inserate mit „ja“ (z. B. Lademöglichkeit für E-Autos) */
export interface FlagFilter extends FilterBase {
  kind: 'flag';
}

export type SearchFilter = OptionsFilter | RangeFilter | WordsFilter | FlagFilter;

/** Monatsgehalt als Vergleichswert für den Gehaltsfilter */
export const SALARY_FILTER_KEY = 'salaryMonthly';

/** Beim Zusammenführen: Werte, die in der Kategorie überhaupt vorkommen können (feste Auswahl wie „Miete“) */
type Collected = SearchFilter & { only?: Set<string> };

function toFilter(field: AttributeField): Collected | null {
  if (!field.filter) return null;
  const base = { key: field.key, param: field.filter.param, label: field.filter.label ?? field.label };
  switch (field.kind) {
    case 'select':
      return { ...base, kind: 'options', match: 'any', options: [...field.options], ...(field.fixed && { only: new Set([field.fixed]) }) };
    case 'multiselect':
      return { ...base, kind: 'options', match: 'all', options: [...field.options] };
    case 'number':
      if (field.key === 'salaryGross') return { ...base, key: SALARY_FILTER_KEY, kind: 'range', min: 0, max: 100_000, decimals: 0, unit: '€', euro: true };
      return { ...base, kind: 'range', min: field.min, max: field.max, decimals: field.decimals, unit: field.unit };
    case 'year':
      return { ...base, kind: 'range', min: field.min, max: new Date().getFullYear() + field.maxAhead, decimals: 0 };
    case 'text':
      return { ...base, kind: 'words', placeholder: field.placeholder };
    case 'boolean':
      return { ...base, kind: 'flag' };
  }
}

/** Führt Filter mit gleichem Schlüssel aus mehreren Unterkategorien zusammen; widersprüchliche fallen weg. */
function merge(target: Collected, next: Collected): Collected | null {
  if (target.kind !== next.kind || target.param !== next.param) return null;
  if (target.kind === 'options' && next.kind === 'options') {
    if (target.match !== next.match) return null;
    const options = [...target.options];
    for (const option of next.options) if (!options.some((o) => o.value === option.value)) options.push(option);
    const only = target.only && next.only ? new Set([...target.only, ...next.only]) : undefined;
    return { ...target, options, only };
  }
  if (target.kind === 'range' && next.kind === 'range') {
    if (target.unit !== next.unit) return null;
    return { ...target, min: Math.min(target.min, next.min), max: Math.max(target.max, next.max), decimals: Math.max(target.decimals, next.decimals) };
  }
  return target;
}

const cache = new Map<string, SearchFilter[]>();

/**
 * Filter für eine Kategorie (Pfad) oder einen Bereich (Slug, z. B. „auto-motor“).
 * Bei Oberkategorien werden die Filter aller Unterkategorien zusammengeführt, damit z. B. unter
 * „Immobilien“ Kaufen/Mieten, Wohnfläche und Zimmer auswählbar sind. Im Marktplatz als Ganzes gibt es
 * keine Eigenschaftsfilter (zu unterschiedliche Waren), erst in der jeweiligen Kategorie.
 */
export function searchFiltersFor(path: string | null | undefined): SearchFilter[] {
  if (!path || path === VERTICAL_SLUGS.MARKETPLACE) return [];
  const cached = cache.get(path);
  if (cached) return cached;

  const paths = [path, ...ATTRIBUTE_RULE_PATHS.filter((p) => p.startsWith(`${path}/`))];
  const byKey = new Map<string, Collected | null>();
  for (const p of paths) {
    for (const field of categoryAttributeSchema(p).fields) {
      const filter = toFilter(field);
      if (!filter) continue;
      if (!byKey.has(filter.key)) byKey.set(filter.key, filter);
      else {
        const existing = byKey.get(filter.key);
        byKey.set(filter.key, existing ? merge(existing, filter) : null);
      }
    }
  }
  const filters = [...byKey.values()]
    .filter((f): f is Collected => f !== null)
    .map(({ only, ...filter }): SearchFilter =>
      filter.kind === 'options' && only ? { ...filter, options: filter.options.filter((o) => only.has(o.value)) } : filter,
    )
    // Auswahl mit nur einer Möglichkeit (z. B. „Miete“ unter Mietwohnungen) ist kein Filter
    .filter((f) => !(f.kind === 'options' && f.options.length < 2));
  cache.set(path, filters);
  return filters;
}

/** Ob in einer Kategorie der allgemeine Artikelzustand (Neu, Gut …) gefiltert werden kann. */
export function hasItemCondition(path: string | null | undefined): boolean {
  if (!path) return true;
  return [path, ...ATTRIBUTE_RULE_PATHS.filter((p) => p.startsWith(`${path}/`))].some((p) => categoryAttributeSchema(p).itemCondition);
}

/** Ob die Kategorie Preise hat (Jobs: nein, dort gibt es den Gehaltsfilter). */
export function hasPrice(path: string | null | undefined): boolean {
  if (!path) return true;
  return [path, ...ATTRIBUTE_RULE_PATHS.filter((p) => p.startsWith(`${path}/`))].some((p) => categoryAttributeSchema(p).price === 'price');
}

/** Alle Filter aller Kategorien (für die Einstellungen des Suchindex). */
export function allSearchFilters(): SearchFilter[] {
  const byKey = new Map<string, SearchFilter>();
  for (const path of ATTRIBUTE_RULE_PATHS) {
    for (const field of categoryAttributeSchema(path).fields) {
      const filter = toFilter(field);
      if (filter && !byKey.has(filter.key)) {
        const { only: _, ...rest } = filter;
        byKey.set(filter.key, rest);
      }
    }
  }
  return [...byKey.values()];
}

/** Wörter für den Freitextfilter (kleingeschrieben, ohne Satzzeichen am Rand). */
export function filterWords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[\s,;/()]+/)
        .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
        .filter(Boolean),
    ),
  ].slice(0, 10);
}

const WEEKS_PER_MONTH = 4.33;
const DEFAULT_WEEKLY_HOURS = 38.5;

/** Bruttogehalt pro Monat (Österreich: 14 Gehälter pro Jahr). */
export function monthlySalary(attributes: ListingAttributes): number | null {
  const amount = attributes.salaryGross;
  if (typeof amount !== 'number') return null;
  switch (attributes.salaryPeriod) {
    case 'year':
      return Math.round(amount / 14);
    case 'hour': {
      const hours = typeof attributes.weeklyHours === 'number' ? attributes.weeklyHours : DEFAULT_WEEKLY_HOURS;
      return Math.round(amount * hours * WEEKS_PER_MONTH);
    }
    default:
      return amount;
  }
}

/**
 * Werte eines Inserats für die Filter – so landen sie im Suchindex.
 * Nur Felder mit `filter`; Freitext als Wortliste, Gehalt als Monatsbetrag.
 */
export function filterValues(attributes: ListingAttributes): Record<string, string | number | boolean | string[]> {
  const values: Record<string, string | number | boolean | string[]> = {};
  for (const filter of allSearchFilters()) {
    if (filter.key === SALARY_FILTER_KEY) {
      const salary = monthlySalary(attributes);
      if (salary !== null) values[SALARY_FILTER_KEY] = salary;
      continue;
    }
    const value = attributes[filter.key];
    if (value === undefined) continue;
    if (filter.kind === 'words') values[filter.key] = typeof value === 'string' ? filterWords(value) : [];
    else values[filter.key] = value;
  }
  return values;
}
