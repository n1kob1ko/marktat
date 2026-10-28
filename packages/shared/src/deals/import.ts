import { parseEuroInputToCents } from '../format.js';
import { z } from '../schemas/zod.js';
import { parseDayInput } from './dates.js';
import type { DealAvailability, DealChannel, DealSource } from './enums.js';
import type { DealFields } from './schemas.js';

/**
 * Massenimport von Deals (CSV-Datei des Händlers bzw. freigegebener Produktfeed): Spalten, Zuordnung,
 * Umwandlung der Zellen in Deal-Felder. Geprüft wird danach mit denselben Regeln wie im Formular.
 */

export const DEAL_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const DEAL_IMPORT_MAX_ROWS = 1000;
/** Importe je Händler und 24 Stunden (Schutz vor Massen-Spam; Vorschauen zählen mit) */
export const DEAL_IMPORT_DAILY_LIMIT = 30;
/** Vorschauen ohne Bestätigung verfallen nach dieser Zeit (die Rohdaten werden gelöscht) */
export const DEAL_IMPORT_PREVIEW_HOURS = 24;

export interface DealImportFieldDef {
  /** Spaltenname in der Vorlage */
  column: string;
  label: string;
  required: boolean;
  /** Weitere übliche Spaltennamen (automatische Zuordnung, ohne Groß-/Kleinschreibung) */
  aliases: string[];
  /** Erklärung und Beispiel in der Ausfüllhilfe */
  hint: string;
  example: string;
}

export const DEAL_IMPORT_FIELDS = {
  externalId: {
    column: 'artikelnummer',
    label: 'Artikelnummer',
    required: true,
    aliases: ['artikel-nr', 'artikelnr', 'sku', 'id', 'angebots-id', 'angebotsnummer', 'offer_id', 'product_id', 'externe_id'],
    hint: 'Deine eigene, gleichbleibende Nummer des Angebots. Beim nächsten Import wird das Angebot mit derselben Nummer aktualisiert statt doppelt angelegt.',
    example: 'NB-15-512',
  },
  title: { column: 'titel', label: 'Titel', required: true, aliases: ['title', 'name', 'produkt', 'produktname', 'bezeichnung'], hint: '5 bis 120 Zeichen', example: 'Notebook 15 Zoll, 16 GB RAM' },
  category: {
    column: 'kategorie',
    label: 'Kategorie',
    required: true,
    aliases: ['category', 'deal-kategorie'],
    hint: 'Name oder Kurzname einer Deal-Kategorie',
    example: 'Elektronik & Computer',
  },
  price: { column: 'preis', label: 'Angebotspreis', required: true, aliases: ['price', 'angebotspreis', 'sale_price', 'aktionspreis'], hint: 'in Euro inkl. USt.', example: '599,00' },
  endsOn: { column: 'ende', label: 'Gültig bis', required: true, aliases: ['end', 'gueltig_bis', 'gültig_bis', 'bis', 'valid_to', 'enddatum'], hint: 'TT.MM.JJJJ oder JJJJ-MM-TT, einschließlich', example: '30.11.2026' },
  startsOn: { column: 'beginn', label: 'Gültig ab', required: false, aliases: ['start', 'gueltig_ab', 'gültig_ab', 'ab', 'valid_from', 'startdatum'], hint: 'leer = heute', example: '01.11.2026' },
  channel: { column: 'kanal', label: 'Kanal', required: false, aliases: ['channel', 'wo'], hint: 'online, lokal oder beides; leer = aus Link und Filialen abgeleitet', example: 'beides' },
  url: { column: 'link', label: 'Link zum Angebot', required: false, aliases: ['url', 'produktlink', 'link_zum_angebot', 'deeplink'], hint: 'https-Adresse in deinem Shop (Pflicht bei Online-Angeboten)', example: 'https://shop.example.at/notebook' },
  affiliate: { column: 'werbelink', label: 'Werbelink', required: false, aliases: ['affiliate', 'affiliate_link', 'provisionslink'], hint: 'ja, wenn der Link eine Provision auslöst', example: 'nein' },
  stores: { column: 'filialen', label: 'Filialen', required: false, aliases: ['stores', 'filiale', 'geschaefte', 'geschäfte'], hint: 'Namen deiner Filialen, getrennt mit |', example: 'Filiale Graz-Lend|Filiale Linz' },
  referencePrice: { column: 'vergleichspreis', label: 'Vergleichspreis', required: false, aliases: ['uvp', 'rrp', 'regular_price', 'streichpreis', 'reference_price'], hint: 'nur mit belegbarer Grundlage', example: '799,00' },
  referenceType: {
    column: 'vergleichspreis_art',
    label: 'Art des Vergleichspreises',
    required: false,
    aliases: ['vergleichspreisart', 'reference_type'],
    hint: 'uvp oder 30_tage (niedrigster Preis der 30 Tage vor der Ermäßigung)',
    example: 'uvp',
  },
  referenceSource: { column: 'vergleichspreis_quelle', label: 'Quelle des Vergleichspreises', required: false, aliases: ['reference_source', 'uvp_quelle'], hint: 'Pflicht bei UVP', example: 'UVP laut Hersteller, Preisliste 10/2026' },
  referenceEvidence: { column: 'vergleichspreis_beleg', label: 'Beleg-Link', required: false, aliases: ['reference_evidence', 'beleg'], hint: 'optional, https', example: '' },
  description: { column: 'beschreibung', label: 'Beschreibung', required: false, aliases: ['description', 'text', 'details'], hint: 'höchstens 3000 Zeichen', example: '512 GB SSD, Windows 11' },
  availability: { column: 'verfuegbarkeit', label: 'Verfügbarkeit', required: false, aliases: ['verfügbarkeit', 'availability', 'lager'], hint: 'lagernd, begrenzt, ausverkauft oder leer', example: 'lagernd' },
  brand: { column: 'marke', label: 'Marke', required: false, aliases: ['brand', 'hersteller'], hint: '', example: 'Beispielmarke' },
  gtin: { column: 'gtin', label: 'GTIN/EAN', required: false, aliases: ['ean', 'barcode'], hint: '8, 12, 13 oder 14 Ziffern', example: '' },
  unitPrice: { column: 'grundpreis', label: 'Grundpreis', required: false, aliases: ['unit_price'], hint: 'z. B. € 2,49 / kg', example: '' },
  shipping: { column: 'versand', label: 'Versand', required: false, aliases: ['shipping', 'versandkosten'], hint: 'z. B. versandkostenfrei', example: 'versandkostenfrei' },
} as const satisfies Record<string, DealImportFieldDef>;

export type DealImportField = keyof typeof DEAL_IMPORT_FIELDS;
export const DEAL_IMPORT_FIELD_KEYS = Object.keys(DEAL_IMPORT_FIELDS) as DealImportField[];

/** Zuordnung: Feld → Spaltenüberschrift der Datei */
export type DealImportMapping = Partial<Record<DealImportField, string>>;

export const dealImportMappingSchema = z
  .record(z.string(), z.string().max(200))
  .transform((value) => {
    const mapping: DealImportMapping = {};
    for (const key of DEAL_IMPORT_FIELD_KEYS) if (value[key]) mapping[key] = value[key];
    return mapping;
  });

export const dealImportCommitSchema = z.object({
  /** Gültige Zeilen veröffentlichen (sonst als Entwurf); bestehende Deals behalten ihren Status */
  publish: z.boolean(),
  /** Pflicht, sobald eine Zeile einen Vergleichspreis enthält */
  confirmReferencePrices: z.boolean().optional(),
});
export type DealImportCommitInput = z.infer<typeof dealImportCommitSchema>;

const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/[\s-]+/g, '_');

/** Spalten automatisch zuordnen (Vorlagenname oder üblicher Alias) */
export function suggestDealImportMapping(headers: string[]): DealImportMapping {
  const mapping: DealImportMapping = {};
  const byName = new Map(headers.map((h) => [normalizeHeader(h), h]));
  for (const key of DEAL_IMPORT_FIELD_KEYS) {
    const def: DealImportFieldDef = DEAL_IMPORT_FIELDS[key];
    for (const candidate of [def.column, ...def.aliases]) {
      const header = byName.get(normalizeHeader(candidate));
      if (header && !Object.values(mapping).includes(header)) {
        mapping[key] = header;
        break;
      }
    }
  }
  return mapping;
}

export function missingRequiredFields(mapping: DealImportMapping): DealImportField[] {
  return DEAL_IMPORT_FIELD_KEYS.filter((key) => DEAL_IMPORT_FIELDS[key].required && !mapping[key]);
}

// --- CSV ------------------------------------------------------------------------------

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

export class CsvParseError extends Error {}

/** Trennzeichen aus der Kopfzeile erraten (Excel in Österreich speichert mit Semikolon) */
function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  let best = ';';
  let bestCount = -1;
  for (const candidate of [';', ',', '\t']) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/**
 * CSV nach RFC 4180 (Anführungszeichen, verdoppelte "" und Zeilenumbrüche in Feldern). Leere Zeilen werden
 * übersprungen, ein BOM am Anfang entfernt. Zellen werden nur als Text gelesen – nie ausgewertet.
 */
export function parseCsv(input: string, maxRows = DEAL_IMPORT_MAX_ROWS): ParsedTable {
  const text = input.replace(/^﻿/, '');
  const delimiter = detectDelimiter(text);
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const pushRecord = () => {
    record.push(field);
    field = '';
    if (record.some((cell) => cell.trim() !== '')) records.push(record);
    record = [];
    if (records.length > maxRows + 1) throw new CsvParseError(`Die Datei hat mehr als ${maxRows} Zeilen. Bitte teile sie auf.`);
  };
  while (i < text.length) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        field += char;
      }
      i++;
      continue;
    }
    if (char === '"' && field === '') quoted = true;
    else if (char === delimiter) {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      pushRecord();
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else field += char;
    i++;
  }
  if (quoted) throw new CsvParseError('Die Datei endet mitten in einem Feld mit Anführungszeichen. Bitte prüfe die Datei.');
  if (field !== '' || record.length) pushRecord();
  const [headerRow, ...rows] = records;
  if (!headerRow) throw new CsvParseError('Die Datei ist leer.');
  const headers = headerRow.map((h) => h.trim());
  if (headers.some((h) => h === '')) throw new CsvParseError('Jede Spalte braucht eine Überschrift in der ersten Zeile.');
  if (new Set(headers.map(normalizeHeader)).size !== headers.length) throw new CsvParseError('Zwei Spalten haben dieselbe Überschrift.');
  if (!rows.length) throw new CsvParseError('Die Datei enthält keine Angebote (nur die Kopfzeile).');
  return { headers, rows, delimiter };
}

/** Produktfeed als JSON: Liste von Objekten (oder { "angebote": [...] }); Schlüssel = Spalten */
export function parseJsonFeed(input: string, maxRows = DEAL_IMPORT_MAX_ROWS): ParsedTable {
  let data: unknown;
  try {
    data = JSON.parse(input);
  } catch {
    throw new CsvParseError('Der Feed ist kein gültiges JSON.');
  }
  const list = Array.isArray(data) ? data : Array.isArray((data as { angebote?: unknown })?.angebote) ? (data as { angebote: unknown[] }).angebote : null;
  if (!list) throw new CsvParseError('Der Feed muss eine Liste von Angeboten sein.');
  if (list.length > maxRows) throw new CsvParseError(`Der Feed hat mehr als ${maxRows} Angebote.`);
  const headers: string[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new CsvParseError('Jedes Angebot im Feed muss ein Objekt sein.');
    for (const key of Object.keys(item)) if (!headers.includes(key)) headers.push(key);
  }
  const rows = list.map((item) =>
    headers.map((key) => {
      const value = (item as Record<string, unknown>)[key];
      if (value === null || value === undefined) return '';
      if (Array.isArray(value)) return value.map(String).join('|');
      return typeof value === 'object' ? '' : String(value);
    }),
  );
  if (!rows.length) throw new CsvParseError('Der Feed enthält keine Angebote.');
  return { headers, rows, delimiter: ',' };
}

/**
 * Schutz vor CSV-/Formel-Injection beim Herunterladen (Vorlage, Fehlerliste): Zellen, die mit = + - @ oder
 * Steuerzeichen beginnen, bekommen ein vorangestelltes Hochkomma, damit Tabellenprogramme sie als Text zeigen.
 */
export function csvCell(value: string | number | null | undefined, delimiter = ';'): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return text.includes(delimiter) || /["\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: (string | number | null | undefined)[][], delimiter = ';'): string {
  // BOM, damit Excel Umlaute richtig erkennt
  return '﻿' + rows.map((row) => row.map((cell) => csvCell(cell, delimiter)).join(delimiter)).join('\r\n') + '\r\n';
}

export function dealImportTemplateCsv(): string {
  return toCsv([DEAL_IMPORT_FIELD_KEYS.map((key) => DEAL_IMPORT_FIELDS[key].column)]);
}

// --- Zeilen → Deal-Felder ---------------------------------------------------------------

export interface DealImportContext {
  /** Kategorien: Kurzname und Anzeigename */
  categories: { slug: string; name: string }[];
  /** Eigene Filialen des Händlers */
  stores: { id: string; name: string }[];
  /** Heute in Wien (yyyy-mm-dd), Standard für „beginn“ */
  today: string;
}

export interface RowIssue {
  field: string;
  message: string;
}

const TRUE_VALUES = new Set(['ja', 'j', 'yes', 'y', 'true', 'wahr', '1', 'x']);
const FALSE_VALUES = new Set(['nein', 'n', 'no', 'false', 'falsch', '0', '']);
const CHANNELS: Record<string, DealChannel> = { online: 'ONLINE', lokal: 'LOCAL', local: 'LOCAL', geschaeft: 'LOCAL', geschäft: 'LOCAL', beides: 'BOTH', both: 'BOTH', 'online_und_lokal': 'BOTH' };
const REFERENCE_TYPES: Record<string, 'RRP' | 'LOWEST_30_DAYS'> = {
  uvp: 'RRP',
  rrp: 'RRP',
  '30_tage': 'LOWEST_30_DAYS',
  '30tage': 'LOWEST_30_DAYS',
  niedrigster_30_tage: 'LOWEST_30_DAYS',
  lowest_30_days: 'LOWEST_30_DAYS',
};
const AVAILABILITIES: Record<string, DealAvailability> = {
  '': 'UNKNOWN',
  unbekannt: 'UNKNOWN',
  lagernd: 'IN_STOCK',
  auf_lager: 'IN_STOCK',
  in_stock: 'IN_STOCK',
  verfuegbar: 'IN_STOCK',
  verfügbar: 'IN_STOCK',
  begrenzt: 'LIMITED',
  limited: 'LIMITED',
  wenige: 'LIMITED',
  ausverkauft: 'SOLD_OUT',
  sold_out: 'SOLD_OUT',
  out_of_stock: 'SOLD_OUT',
};

const key = (value: string) => value.trim().toLowerCase().replace(/[\s-]+/g, '_');

/** Euro-Beträge aus Datei oder Feed: „1.299,90“, „1299.90“, „€ 599“ */
function parseAmount(value: string): number | null {
  const cents = parseEuroInputToCents(value);
  if (cents !== null) return cents;
  // Feeds mit Punkt als Dezimaltrennzeichen und drei Nachkommastellen gibt es nicht; mehr nicht raten
  return null;
}

/**
 * Eine Zeile in Deal-Felder umwandeln. Liefert die Felder (ungeprüft gegen die Deal-Regeln) und Fehler bei
 * Werten, die sich nicht umwandeln lassen. Die eigentliche Prüfung macht danach dealCompleteSchema.
 */
export function dealImportRowToFields(
  headers: string[],
  row: string[],
  mapping: DealImportMapping,
  context: DealImportContext,
): { fields: Partial<DealFields>; issues: RowIssue[] } {
  const issues: RowIssue[] = [];
  const index = new Map(headers.map((h, i) => [h, i]));
  const cell = (field: DealImportField) => {
    const header = mapping[field];
    if (!header) return '';
    const i = index.get(header);
    return i === undefined ? '' : (row[i] ?? '').trim();
  };
  const label = (field: DealImportField) => DEAL_IMPORT_FIELDS[field].label;

  const fields: Partial<DealFields> = {
    externalId: cell('externalId'),
    title: cell('title'),
    description: cell('description'),
    brand: cell('brand'),
    gtin: cell('gtin'),
    unitPriceText: cell('unitPrice'),
    shippingNote: cell('shipping'),
    referencePriceSource: cell('referenceSource'),
    referencePriceEvidenceUrl: cell('referenceEvidence'),
    url: cell('url'),
  };
  if (!fields.externalId) issues.push({ field: 'externalId', message: 'Die Artikelnummer fehlt. Sie ist für wiederholte Importe nötig.' });

  const categoryValue = cell('category');
  const category = context.categories.find((c) => c.slug === key(categoryValue).replace(/_/g, '-') || c.name.toLowerCase() === categoryValue.toLowerCase());
  if (category) fields.categorySlug = category.slug;
  else issues.push({ field: 'categorySlug', message: categoryValue ? `Die Kategorie „${categoryValue.slice(0, 60)}“ gibt es nicht.` : 'Die Kategorie fehlt.' });

  const price = cell('price');
  const priceCents = price ? parseAmount(price) : null;
  if (priceCents === null) issues.push({ field: 'priceCents', message: price ? `${label('price')}: „${price.slice(0, 30)}“ ist kein gültiger Betrag.` : 'Der Angebotspreis fehlt.' });
  else fields.priceCents = priceCents;

  const reference = cell('referencePrice');
  if (reference) {
    const referenceCents = parseAmount(reference);
    if (referenceCents === null) issues.push({ field: 'referencePriceCents', message: `${label('referencePrice')}: „${reference.slice(0, 30)}“ ist kein gültiger Betrag.` });
    else fields.referencePriceCents = referenceCents;
    const typeValue = key(cell('referenceType'));
    const type = REFERENCE_TYPES[typeValue];
    if (type) fields.referencePriceType = type;
    else issues.push({ field: 'referencePriceType', message: typeValue ? `Unbekannte Art des Vergleichspreises „${typeValue.slice(0, 30)}“ (uvp oder 30_tage).` : 'Bitte gib an, worauf sich der Vergleichspreis bezieht (uvp oder 30_tage).' });
  } else {
    fields.referencePriceCents = null;
    fields.referencePriceType = null;
  }

  const storesValue = cell('stores');
  const storeNames = storesValue ? storesValue.split('|').map((s) => s.trim()).filter(Boolean) : [];
  const storeIds: string[] = [];
  for (const name of storeNames) {
    const store = context.stores.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (store) storeIds.push(store.id);
    else issues.push({ field: 'storeIds', message: `Die Filiale „${name.slice(0, 60)}“ gibt es in deinem Konto nicht.` });
  }
  fields.storeIds = storeIds;

  const channelValue = key(cell('channel'));
  if (channelValue) {
    const channel = CHANNELS[channelValue];
    if (channel) fields.channel = channel;
    else issues.push({ field: 'channel', message: `Unbekannter Kanal „${channelValue.slice(0, 30)}“ (online, lokal oder beides).` });
  } else {
    fields.channel = fields.url && storeNames.length ? 'BOTH' : storeNames.length ? 'LOCAL' : 'ONLINE';
  }

  const affiliate = key(cell('affiliate'));
  if (TRUE_VALUES.has(affiliate)) fields.isAffiliateLink = true;
  else if (FALSE_VALUES.has(affiliate)) fields.isAffiliateLink = false;
  else issues.push({ field: 'isAffiliateLink', message: 'Werbelink: bitte „ja“ oder „nein“.' });

  const availability = AVAILABILITIES[key(cell('availability'))];
  if (availability) fields.availability = availability;
  else issues.push({ field: 'availability', message: 'Verfügbarkeit: lagernd, begrenzt, ausverkauft oder leer.' });

  const starts = cell('startsOn');
  const startsOn = starts ? parseDayInput(starts) : context.today;
  if (startsOn) fields.startsOn = startsOn;
  else issues.push({ field: 'startsOn', message: `Beginn: „${starts.slice(0, 30)}“ ist kein gültiges Datum.` });
  const ends = cell('endsOn');
  const endsOn = ends ? parseDayInput(ends) : null;
  if (endsOn) fields.endsOn = endsOn;
  else issues.push({ field: 'endsOn', message: ends ? `Ende: „${ends.slice(0, 30)}“ ist kein gültiges Datum.` : 'Das Enddatum fehlt.' });

  return { fields, issues };
}

// --- Antworten der API ------------------------------------------------------------------

export const DEAL_IMPORT_STATUSES = ['PREVIEW', 'COMMITTED', 'FAILED', 'CANCELLED', 'EXPIRED'] as const;
export type DealImportStatus = (typeof DEAL_IMPORT_STATUSES)[number];
export const DEAL_IMPORT_STATUS_LABELS: Record<DealImportStatus, string> = {
  PREVIEW: 'Vorschau – noch nicht übernommen',
  COMMITTED: 'Übernommen',
  FAILED: 'Fehlgeschlagen',
  CANCELLED: 'Verworfen',
  EXPIRED: 'Vorschau abgelaufen',
};

export const DEAL_IMPORT_ACTIONS = ['CREATE', 'UPDATE', 'UNCHANGED', 'SKIP', 'END', 'ERROR'] as const;
export type DealImportAction = (typeof DEAL_IMPORT_ACTIONS)[number];
export const DEAL_IMPORT_ACTION_LABELS: Record<DealImportAction, string> = {
  CREATE: 'Neu',
  UPDATE: 'Aktualisieren',
  UNCHANGED: 'Unverändert',
  SKIP: 'Übersprungen',
  END: 'Beendet (nicht mehr im Feed)',
  ERROR: 'Fehler',
};

export interface DealImportRowResult {
  /** Zeilennummer in der Datei (Kopfzeile = 1) */
  line: number;
  externalId: string | null;
  title: string | null;
  action: DealImportAction;
  dealId: string | null;
  /** Geänderte Felder bei Aktualisierungen (nachvollziehbar) */
  changes: string[];
  messages: string[];
  /** Hinweise, die den Import nicht verhindern (z. B. mögliche Doppelte) */
  warnings: string[];
}

export interface DealImportCounts {
  total: number;
  create: number;
  update: number;
  unchanged: number;
  skip: number;
  /** Feed: Angebote, die nicht mehr im Feed stehen, werden beendet */
  ended: number;
  error: number;
}

export interface DealImportView {
  id: string;
  source: DealSource;
  feedId: string | null;
  fileName: string | null;
  status: DealImportStatus;
  headers: string[];
  mapping: DealImportMapping;
  missingFields: DealImportField[];
  counts: DealImportCounts;
  /** Zeilen der Vorschau bzw. Ergebnis (höchstens DEAL_IMPORT_MAX_ROWS) */
  rows: DealImportRowResult[];
  /** Enthält Vergleichspreise → Bestätigung beim Übernehmen nötig */
  hasReferencePrices: boolean;
  publish: boolean | null;
  error: string | null;
  createdAt: string;
  committedAt: string | null;
  expiresAt: string | null;
}

export type DealImportSummary = Omit<DealImportView, 'rows' | 'headers' | 'mapping' | 'missingFields'>;

/** Importfehler in der Moderation (fehlgeschlagene Importe und Importe mit fehlerhaften Zeilen) */
export interface AdminDealImportSummary extends DealImportSummary {
  merchant: { id: string; name: string };
}
