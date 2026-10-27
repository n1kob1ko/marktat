import type { Vertical } from './enums.js';

export interface AttributeField {
  key: string;
  label: string;
  kind: 'number' | 'text';
  min?: number;
  max?: number;
  unit?: string;
}

/** Erstes Phase-3-Paket: zusätzliche Angaben nach Inseratsbereich. */
export const ATTRIBUTE_FIELDS: Record<Vertical, readonly AttributeField[]> = {
  MARKETPLACE: [],
  VEHICLES: [
    { key: 'mileageKm', label: 'Kilometerstand', kind: 'number', min: 0, max: 5_000_000, unit: 'km' },
    { key: 'firstRegistrationYear', label: 'Erstzulassung (Jahr)', kind: 'number', min: 1886, max: 2100 },
  ],
  REAL_ESTATE: [
    { key: 'livingAreaSqm', label: 'Wohnfläche', kind: 'number', min: 1, max: 100_000, unit: 'm²' },
    { key: 'rooms', label: 'Zimmer', kind: 'number', min: 0.5, max: 100 },
  ],
  JOBS: [
    { key: 'weeklyHours', label: 'Wochenstunden', kind: 'number', min: 1, max: 80, unit: 'h' },
    { key: 'salaryGrossMonthly', label: 'Bruttomonatsgehalt', kind: 'number', min: 0, max: 1_000_000, unit: '€' },
  ],
};

export type ListingAttributeValues = Record<string, string | number | boolean>;

export function validateListingAttributes(vertical: Vertical, attributes: ListingAttributeValues): { path: string; message: string }[] {
  const fields = ATTRIBUTE_FIELDS[vertical];
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const errors: { path: string; message: string }[] = [];
  for (const [key, value] of Object.entries(attributes)) {
    const field = byKey.get(key);
    if (!field) {
      errors.push({ path: 'attributes.' + key, message: 'Diese Angabe ist für die Kategorie nicht zulässig.' });
      continue;
    }
    if (field.kind === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) {
        errors.push({ path: 'attributes.' + key, message: 'Bitte gib einen gültigen Wert für ' + field.label + ' ein.' });
      }
    } else if (typeof value !== 'string' || value.length > 200) {
      errors.push({ path: 'attributes.' + key, message: 'Bitte gib einen gültigen Wert für ' + field.label + ' ein.' });
    }
  }
  return errors;
}
