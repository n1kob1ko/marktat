import type {
  AttributeField,
  AttributeIssue,
  AttributeValue,
  CategoryAttributeSchema,
  ListingAttributes,
} from './types.js';

const PATH_PREFIX = 'attributes.';
const NUMBER_FORMAT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

export const attributePath = (key: string) => PATH_PREFIX + key;

function currentYear(now: Date) {
  return Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Europe/Vienna' }).format(now));
}

function rangeText(min: number, max: number, unit?: string) {
  return `zwischen ${NUMBER_FORMAT.format(min)} und ${NUMBER_FORMAT.format(max)}${unit ? ` ${unit}` : ''}`;
}

function hasDecimals(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.abs(Math.round(value * factor) - value * factor) < 1e-6;
}

/** Leere Werte zählen als „nicht angegeben“ – auch in gespeicherten Altdaten. */
export function isEmptyAttribute(value: unknown) {
  return value === undefined || value === null || value === '' || value === false || (Array.isArray(value) && value.length === 0);
}

/**
 * Prüft einen einzelnen Wert. Gibt den bereinigten Wert oder eine verständliche Fehlermeldung zurück.
 */
function checkValue(field: AttributeField, value: unknown, now: Date): { value: AttributeValue } | { error: string } {
  const label = `„${field.label}“`;
  switch (field.kind) {
    case 'text': {
      if (typeof value !== 'string') return { error: `Bitte gib bei ${label} einen Text ein.` };
      const text = value.replace(/\s+/g, ' ').trim();
      if (text.length > field.maxLength) return { error: `${field.label} darf höchstens ${field.maxLength} Zeichen lang sein.` };
      return { value: text };
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return { error: `Bitte gib bei ${label} eine Zahl ein.` };
      if (value < field.min || value > field.max) {
        return { error: `${field.label} muss ${rangeText(field.min, field.max, field.unit)} liegen.` };
      }
      if (!hasDecimals(value, field.decimals)) {
        return {
          error: field.decimals === 0
            ? `${field.label} muss eine ganze Zahl sein.`
            : `${field.label} darf höchstens ${field.decimals} Nachkommastelle${field.decimals > 1 ? 'n' : ''} haben.`,
        };
      }
      if (field.step && !hasDecimals(value / field.step, 0)) {
        return { error: `${field.label} ist nur in Schritten von ${NUMBER_FORMAT.format(field.step)} möglich.` };
      }
      return { value: Number(value.toFixed(field.decimals)) };
    }
    case 'year': {
      const max = currentYear(now) + field.maxAhead;
      if (typeof value !== 'number' || !Number.isInteger(value)) return { error: `Bitte gib bei ${label} eine Jahreszahl ein, z. B. 2019.` };
      if (value < field.min || value > max) return { error: `${field.label} muss zwischen ${field.min} und ${max} liegen.` };
      return { value };
    }
    case 'select': {
      if (typeof value !== 'string' || !field.options.some((o) => o.value === value)) {
        return { error: `Bitte wähle bei ${label} einen der vorgegebenen Werte.` };
      }
      if (field.fixed && value !== field.fixed) {
        const fixedLabel = field.options.find((o) => o.value === field.fixed)?.label ?? field.fixed;
        return { error: `In dieser Kategorie ist ${label} immer „${fixedLabel}“.` };
      }
      return { value };
    }
    case 'multiselect': {
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !field.options.some((o) => o.value === v))) {
        return { error: `Bitte wähle bei ${label} nur vorgegebene Werte.` };
      }
      // Reihenfolge wie in der Optionsliste, doppelte Einträge entfernen
      return { value: field.options.filter((o) => value.includes(o.value)).map((o) => o.value) };
    }
    case 'boolean':
      if (typeof value !== 'boolean') return { error: `${label} muss ja oder nein sein.` };
      return { value };
  }
}

export interface AttributeParseResult {
  attributes: ListingAttributes;
  issues: AttributeIssue[];
}

/**
 * Strenge Prüfung übermittelter Zusatzangaben (API-Eingang):
 * unbekannte Felder, falsche Typen, Werte außerhalb des erlaubten Bereichs werden gemeldet.
 * Leere Werte werden entfernt, feste Werte der Kategorie (z. B. Miete) immer gesetzt.
 */
export function parseListingAttributes(
  schema: CategoryAttributeSchema,
  input: Record<string, unknown>,
  now = new Date(),
): AttributeParseResult {
  const byKey = new Map(schema.fields.map((field) => [field.key, field]));
  const attributes: ListingAttributes = {};
  const issues: AttributeIssue[] = [];
  for (const key of Object.keys(input)) {
    if (!byKey.has(key)) {
      issues.push({
        path: attributePath(key),
        message: schema.fields.length
          ? 'Diese Angabe passt nicht zur gewählten Kategorie.'
          : 'Für diese Kategorie gibt es keine Zusatzangaben.',
      });
    }
  }
  for (const field of schema.fields) {
    const raw = input[field.key];
    if (isEmptyAttribute(raw)) {
      if (field.kind === 'select' && field.fixed) attributes[field.key] = field.fixed;
      continue;
    }
    const result = checkValue(field, raw, now);
    if ('error' in result) issues.push({ path: attributePath(field.key), message: result.error });
    else if (!isEmptyAttribute(result.value)) attributes[field.key] = result.value;
  }
  return { attributes, issues };
}

/**
 * Übernimmt gespeicherte Angaben (z. B. nach einem Kategoriewechsel oder aus älteren Inseraten),
 * soweit sie zur Kategorie passen. Alles andere wird stillschweigend verworfen.
 */
export function carryOverAttributes(schema: CategoryAttributeSchema, stored: unknown, now = new Date()): ListingAttributes {
  const source = stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const attributes: ListingAttributes = {};
  for (const field of schema.fields) {
    const raw = source[field.key];
    if (field.kind === 'select' && field.fixed) {
      attributes[field.key] = field.fixed;
      continue;
    }
    // Mehrfachauswahl: einzelne nicht mehr passende Werte entfernen, den Rest behalten
    const value = field.kind === 'multiselect' && Array.isArray(raw)
      ? raw.filter((v) => field.options.some((o) => o.value === v))
      : raw;
    if (isEmptyAttribute(value)) continue;
    const result = checkValue(field, value, now);
    if (!('error' in result) && !isEmptyAttribute(result.value)) attributes[field.key] = result.value;
  }
  return attributes;
}

/** Pflichtangaben, die zum Veröffentlichen fehlen. */
export function missingRequiredAttributes(schema: CategoryAttributeSchema, attributes: ListingAttributes): AttributeIssue[] {
  const issues: AttributeIssue[] = [];
  for (const field of schema.fields) {
    const required = field.required || (field.requiredWith ? !isEmptyAttribute(attributes[field.requiredWith]) : false);
    if (!required || !isEmptyAttribute(attributes[field.key])) continue;
    const verb = field.kind === 'select' || field.kind === 'multiselect' ? 'wähle' : 'gib';
    issues.push({
      path: attributePath(field.key),
      message: `Bitte ${verb} „${field.label}“${verb === 'gib' ? ' an' : ''}.`,
    });
  }
  return issues;
}

/**
 * Zahl aus einer Eingabe im österreichischen Format: „85.000“, „2,5“, „1.299,90“, „38.5“.
 * Gibt `null` zurück, wenn die Eingabe keine Zahl ist.
 */
export function parseLocaleNumber(input: string): number | null {
  const raw = input.trim().replace(/[\s\u00a0\u202f']/g, '').replace(/^\+/, '');
  if (raw === '') return null;
  let normalized: string;
  if (raw.includes(',')) normalized = raw.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(raw)) normalized = raw.replace(/\./g, '');
  else normalized = raw;
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

/**
 * Liest die Zusatzfelder aus einem HTML-Formular (Feldnamen `attr.<schlüssel>`) und wandelt sie
 * in typisierte Werte um. Nur Felder der aktuellen Kategorie werden gelesen – versteckte Werte
 * einer vorher gewählten Kategorie können so nicht mitgespeichert werden.
 */
export function readAttributeForm(
  schema: CategoryAttributeSchema,
  getAll: (name: string) => string[],
): AttributeParseResult & { raw: Record<string, string> } {
  const attributes: Record<string, unknown> = {};
  const issues: AttributeIssue[] = [];
  const raw: Record<string, string> = {};
  for (const field of schema.fields) {
    if (field.kind === 'select' && field.fixed) continue;
    const values = getAll(`attr.${field.key}`).map((v) => v.trim()).filter(Boolean);
    if (!values.length) continue;
    raw[field.key] = values.join(',');
    const first = values[0]!;
    switch (field.kind) {
      case 'number':
      case 'year': {
        const number = parseLocaleNumber(first);
        if (number === null) issues.push({ path: attributePath(field.key), message: `Bitte gib bei „${field.label}“ eine Zahl ein.` });
        else attributes[field.key] = number;
        break;
      }
      case 'multiselect':
        attributes[field.key] = values;
        break;
      case 'boolean':
        attributes[field.key] = first === 'true' || first === 'on';
        break;
      default:
        attributes[field.key] = first;
    }
  }
  return { attributes: attributes as ListingAttributes, issues, raw };
}
