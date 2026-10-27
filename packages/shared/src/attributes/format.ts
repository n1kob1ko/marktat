import { carryOverAttributes } from './validation.js';
import type { AttributeField, CategoryAttributeSchema, ListingAttributes } from './types.js';

// de-DE statt de-AT: de-AT gruppiert mit Leerzeichen („85 000“), Preise erscheinen aber als „€ 85.000“.
const numberFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
const euroFormat = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });

const KW_TO_PS = 1.35962;

export interface AttributeDisplayItem {
  key: string;
  label: string;
  /** Fertig formatierter Wert, bei Mehrfachauswahl kommagetrennt */
  value: string;
  /** Einzelwerte einer Mehrfachauswahl (z. B. Ausstattung), sonst undefined */
  values?: string[];
}

function optionLabel(field: AttributeField, value: string) {
  return 'options' in field ? (field.options.find((o) => o.value === value)?.label ?? value) : value;
}

function formatEuro(value: number) {
  return euroFormat.format(value).replace(/,00$/, '');
}

function formatField(field: AttributeField, attributes: ListingAttributes): string | null {
  const value = attributes[field.key];
  if (value === undefined) return null;
  switch (field.kind) {
    case 'number': {
      const number = value as number;
      if (field.display === 'kw-ps') return `${numberFormat.format(number)} kW (${numberFormat.format(Math.round(number * KW_TO_PS))} PS)`;
      if (field.key === 'salaryGross') return formatSalary(attributes);
      if (field.display === 'euro') return `${formatEuro(number)}${field.unit && field.unit !== '€' ? ` ${field.unit.replace(/^€\s*/, '')}` : ''}`;
      return `${numberFormat.format(number)}${field.unit ? ` ${field.unit}` : ''}`;
    }
    case 'year': {
      const month = field.monthKey ? attributes[field.monthKey] : undefined;
      return typeof month === 'string' ? `${month}/${value}` : String(value);
    }
    case 'select':
      return optionLabel(field, value as string);
    case 'multiselect':
      return (value as string[]).map((v) => optionLabel(field, v)).join(', ');
    case 'boolean':
      return value ? 'Ja' : null;
    default:
      return String(value);
  }
}

/**
 * Gehalt lang („€ 2.400 brutto pro Monat, Überzahlung möglich“) für die Details
 * oder kurz („€ 2.400 brutto/Monat“) anstelle des Preises auf Karten und im Kopf der Detailseite.
 */
export function formatSalary(attributes: ListingAttributes, short = false): string | null {
  const amount = attributes.salaryGross;
  if (typeof amount !== 'number') return null;
  const period = attributes.salaryPeriod as string;
  if (short) {
    const unit = { month: 'Monat', year: 'Jahr', hour: 'Stunde' }[period];
    return `${formatEuro(amount)} brutto${unit ? `/${unit}` : ''}`;
  }
  const label = { month: 'pro Monat', year: 'pro Jahr', hour: 'pro Stunde' }[period];
  return `${formatEuro(amount)} brutto${label ? ` ${label}` : ''}${attributes.overpayment === true ? ', Überzahlung möglich' : ''}`;
}

/**
 * Angaben für die Detailseite in der Reihenfolge der Felddefinition.
 * Nur Werte, die zur Kategorie passen – Altdaten oder fremde Felder werden nicht angezeigt.
 */
export function describeListingAttributes(schema: CategoryAttributeSchema, stored: unknown): AttributeDisplayItem[] {
  const attributes = carryOverAttributes(schema, stored);
  const items: AttributeDisplayItem[] = [];
  for (const field of schema.fields) {
    if (field.kind === 'select' && field.hiddenInDetails) continue;
    // Überzahlung steht bereits beim Gehalt
    if (field.key === 'overpayment' && typeof attributes.salaryGross === 'number') continue;
    const value = formatField(field, attributes);
    if (value === null) continue;
    items.push({
      key: field.key,
      label: field.label,
      value,
      values: field.kind === 'multiselect' ? (attributes[field.key] as string[]).map((v) => optionLabel(field, v)) : undefined,
    });
  }
  return items;
}

/** Bis zu drei Kurzinfos für Inseratskarten, z. B. „03/2019 · 85.000 km · Diesel“. */
export function listingFacts(schema: CategoryAttributeSchema, stored: unknown, max = 3): string[] {
  const attributes = carryOverAttributes(schema, stored);
  const facts: string[] = [];
  for (const field of schema.fields) {
    if (!field.highlight || facts.length >= max) continue;
    const value = formatField(field, attributes);
    if (value === null) continue;
    // Werte ohne Einheit brauchen die Beschriftung („Zimmer: 2,5“), sonst reicht der Wert („85.000 km“)
    const needsLabel = field.kind === 'text' || (field.kind === 'number' && !field.unit && !field.display);
    facts.push(needsLabel ? `${field.label}: ${value}` : value);
  }
  return facts;
}

/** Zusatz zum Preis, z. B. „/ Monat“ bei Miete oder „/ Stunde“ bei Dienstleistungen. */
export function priceSuffix(schema: CategoryAttributeSchema, stored: unknown): string | null {
  const attributes = carryOverAttributes(schema, stored);
  if (attributes.offerType === 'RENT') return 'pro Monat';
  if (attributes.pricePer === 'hour') return 'pro Stunde';
  if (attributes.pricePer === 'day') return 'pro Tag';
  return null;
}

/** Bezeichnung des Preisfeldes im Formular. */
export function priceFieldLabel(schema: CategoryAttributeSchema, attributes: ListingAttributes): string {
  const offer = schema.fields.find((f) => f.key === 'offerType');
  const offerType = offer && offer.kind === 'select' ? (offer.fixed ?? attributes.offerType) : undefined;
  if (offerType === 'RENT') return 'Miete pro Monat in Euro';
  if (offerType === 'BUY') return 'Kaufpreis in Euro';
  return 'Preis in Euro';
}
