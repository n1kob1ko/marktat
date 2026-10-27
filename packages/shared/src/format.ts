const LOCALE = 'de-AT';

const euroFormatter = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'EUR',
});

const euroFormatterNoCents = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

/** Formatiert einen Cent-Betrag im österreichischen Format, z. B. „€ 1.299,00“. */
export function formatPriceCents(cents: number): string {
  const euros = cents / 100;
  return Number.isInteger(euros) ? euroFormatterNoCents.format(euros) : euroFormatter.format(euros);
}

/**
 * Wandelt eine Benutzereingabe wie „1.299,50“, „1299.5“ oder „1299“ in Cent um.
 * Gibt `null` zurück, wenn die Eingabe kein gültiger Betrag ist.
 */
export function parseEuroInputToCents(input: string): number | null {
  const raw = input.trim().replace(/\s|€/g, '');
  if (raw === '') return null;
  let normalized: string;
  if (raw.includes(',')) {
    // Österreichisches Format: Punkt = Tausendertrennzeichen, Komma = Dezimaltrennzeichen
    normalized = raw.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    // „1.299“ ohne Komma ist im deutschsprachigen Raum ein Tausenderpunkt
    normalized = raw.replace(/\./g, '');
  } else {
    normalized = raw;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Europe/Vienna',
});

export function formatDate(value: string | Date): string {
  return dateFormatter.format(typeof value === 'string' ? new Date(value) : value);
}

const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Vienna',
});

/** Datum mit Uhrzeit (Wiener Zeit), z. B. für Protokolle und Moderationsverläufe */
export function formatDateTime(value: string | Date): string {
  return dateTimeFormatter.format(typeof value === 'string' ? new Date(value) : value);
}
