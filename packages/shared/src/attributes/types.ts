/**
 * Kategorieabhängige Zusatzangaben eines Inserats (Kilometerstand, Wohnfläche, Gehalt …).
 * Gespeichert werden sie in `listings.attributes` (JSON), definiert sind sie hier im Code,
 * damit Formular (Web) und Prüfung (API) garantiert dieselben Regeln verwenden.
 */

export type AttributeValue = string | number | boolean | string[];
export type ListingAttributes = Record<string, AttributeValue>;

export interface AttributeOption {
  value: string;
  label: string;
}

interface BaseField {
  /** Schlüssel in `listings.attributes`; nie umbenennen, sonst gehen gespeicherte Werte verloren. */
  key: string;
  label: string;
  hint?: string;
  placeholder?: string;
  /** Pflicht beim Veröffentlichen (Entwürfe dürfen unvollständig sein). */
  required?: boolean;
  /** Pflicht, sobald das genannte Feld ausgefüllt ist (z. B. Zeitraum zum Gehalt). */
  requiredWith?: string;
  /** Erscheint als Kurzinfo auf Inseratskarten (max. drei je Kategorie sinnvoll). */
  highlight?: boolean;
}

export interface TextField extends BaseField {
  kind: 'text';
  maxLength: number;
}

export interface NumberField extends BaseField {
  kind: 'number';
  min: number;
  max: number;
  /** Erlaubte Nachkommastellen, 0 = ganze Zahl */
  decimals: number;
  /** Raster, z. B. 0.5 für Zimmeranzahl */
  step?: number;
  unit?: string;
  /** Sonderdarstellung: kW zusätzlich in PS, Beträge als Euro */
  display?: 'kw-ps' | 'euro';
}

export interface YearField extends BaseField {
  kind: 'year';
  min: number;
  /** Wie viele Jahre über das aktuelle hinaus erlaubt sind */
  maxAhead: number;
  /** Optionales Monatsfeld, das in der Anzeige mit dem Jahr zusammengefasst wird („03/2019“) */
  monthKey?: string;
}

export interface SelectField extends BaseField {
  kind: 'select';
  options: readonly AttributeOption[];
  /** Ergibt sich aus der Kategorie (z. B. „Miete“ bei Mietwohnungen) und ist nicht wählbar. */
  fixed?: string;
  /** Nur zusammen mit einem anderen Feld anzeigen (z. B. Monat der Erstzulassung) */
  hiddenInDetails?: boolean;
}

export interface MultiSelectField extends BaseField {
  kind: 'multiselect';
  options: readonly AttributeOption[];
}

export interface BooleanField extends BaseField {
  kind: 'boolean';
}

export type AttributeField = TextField | NumberField | YearField | SelectField | MultiSelectField | BooleanField;

/** Was eine Kategorie im Formular abfragt. */
export interface CategoryAttributeSchema {
  fields: readonly AttributeField[];
  /** Allgemeiner Artikelzustand (Neu, Gut …) – nur bei Waren sinnvoll */
  itemCondition: boolean;
  /** `none`: kein Preis (Jobs – das Gehalt steht in den Zusatzangaben) */
  price: 'price' | 'none';
  /** Überschrift der Standortangabe im Formular */
  locationLabel: string;
}

export interface AttributeIssue {
  /** Feldpfad wie bei zod, z. B. `attributes.mileageKm` */
  path: string;
  message: string;
}
