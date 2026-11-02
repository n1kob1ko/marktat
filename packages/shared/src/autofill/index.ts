/**
 * Foto-Assistent: Aus einem Foto (z. B. der Verpackung einer Grafikkarte) schlägt die API Kategorie, Titel,
 * Beschreibung, Zustand und Zusatzangaben vor. Die Vorschläge landen nur im Formular – gespeichert wird erst,
 * wenn die Person das Inserat selbst abschickt.
 */
import type { CategoryAttributeSchema, ListingAttributes } from '../attributes/types.js';
import { parseListingAttributes, parseLocaleNumber } from '../attributes/validation.js';
import type { ItemCondition } from '../enums.js';

/** Größte Datei, die an die API geschickt werden darf (der Browser verkleinert vorher auf ca. 0,3–1 MB) */
export const AUTOFILL_MAX_BYTES = 8 * 1024 * 1024;
export const AUTOFILL_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Längste Kante, auf die der Browser verkleinert, bevor das Foto hochgeladen wird */
export const AUTOFILL_UPLOAD_EDGE = 1600;

export interface AutofillStatus {
  enabled: boolean;
}

export interface AutofillSuggestion {
  /** false: Auf dem Foto war nichts zu erkennen, das man inserieren könnte – dann ist alles leer */
  recognized: boolean;
  /** Unterste Kategorie (Blatt) oder null, wenn keine sicher passt */
  categoryId: string | null;
  categoryPath: string | null;
  title: string;
  description: string;
  condition: ItemCondition | null;
  /** Nur gültige Werte der vorgeschlagenen Kategorie (gleiche Prüfung wie beim Speichern) */
  attributes: ListingAttributes;
}

/** Ein Wert, wie ihn das Sprachmodell liefert (immer als Text, damit das Ausgabeformat einfach bleibt) */
export interface RawAttributeSuggestion {
  key: string;
  value: string;
}

const norm = (value: string) => value.toLocaleLowerCase('de-AT').replace(/[^a-z0-9äöüß.,]+/g, '');

/**
 * Wandelt die Textwerte des Modells in typisierte Zusatzangaben um und behält nur, was die Prüfung der Kategorie
 * besteht. Auswahlfelder akzeptieren den Wert oder die Beschriftung („16 GB“ → „16“), Zahlen auch österreichisch
 * geschrieben („1.000“, „2,5“). Feste Werte (z. B. Miete) und Unbekanntes werden ignoriert.
 */
export function coerceAttributeSuggestions(schema: CategoryAttributeSchema, raw: readonly RawAttributeSuggestion[]): ListingAttributes {
  const input: Record<string, unknown> = {};
  for (const field of schema.fields) {
    if (field.kind === 'select' && field.fixed) continue;
    const values = raw.filter((r) => r.key === field.key).map((r) => r.value.trim()).filter(Boolean);
    const first = values[0];
    if (!first) continue;
    let value: unknown;
    switch (field.kind) {
      case 'select': {
        const option = field.options.find((o) => o.value === first) ?? field.options.find((o) => norm(o.label) === norm(first));
        value = option?.value;
        break;
      }
      case 'multiselect': {
        const parts = values.flatMap((v) => v.split(/\s*[,;]\s*/));
        value = field.options
          .filter((o) => parts.some((p) => p === o.value || norm(p) === norm(o.label)))
          .map((o) => o.value);
        break;
      }
      case 'number':
      case 'year':
        value = parseLocaleNumber(first.replace(/[^\d.,\s-]/g, ''));
        break;
      case 'boolean':
        value = /^(true|ja|yes)$/i.test(first) ? true : undefined;
        break;
      case 'text':
        value = first.slice(0, field.maxLength);
        break;
    }
    if (value === undefined || value === null) continue;
    // Einzeln prüfen: ein ungültiger Wert soll die übrigen Vorschläge nicht verwerfen
    const single = parseListingAttributes({ ...schema, fields: [field] }, { [field.key]: value });
    if (!single.issues.length && single.attributes[field.key] !== undefined) input[field.key] = single.attributes[field.key];
  }
  return parseListingAttributes(schema, input).attributes;
}
