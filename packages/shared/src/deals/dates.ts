/**
 * Gültigkeit von Angeboten wird tageweise angegeben („gültig von 28.10. bis 2.11.“) und gilt in Wiener Zeit:
 * Beginn 00:00 Uhr des ersten Tages, Ende 23:59:59,999 Uhr des letzten Tages.
 * Die Umrechnung teilt sich der Deal-Bereich mit den Datumsfeldern der Monetarisierung (billing.ts).
 */
import { viennaDay, viennaDayStart } from '../billing.js';

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** „2026-11-02“ ist ein gültiger Kalendertag? */
export function isCalendarDay(value: string): boolean {
  const match = DAY.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Beginn eines Angebots: 00:00 Uhr Wiener Zeit */
export function dealStartsAt(day: string): Date {
  return viennaDayStart(day);
}

/** Ende eines Angebots: letzte Millisekunde des Tages in Wiener Zeit */
export function dealEndsAt(day: string): Date {
  return new Date(viennaDayStart(day, 1).getTime() - 1);
}

/** Kalendertag in Wiener Zeit, z. B. „2026-11-02“ */
export const toViennaDay = (value: Date | string) => viennaDay(value);

/** Liest „2026-11-02“, „02.11.2026“ oder „2.11.2026“; null bei ungültigen Angaben. */
export function parseDayInput(input: string): string | null {
  const value = input.trim();
  if (DAY.test(value)) return isCalendarDay(value) ? value : null;
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value);
  if (!match) return null;
  const day = `${match[3]}-${match[2]!.padStart(2, '0')}-${match[1]!.padStart(2, '0')}`;
  return isCalendarDay(day) ? day : null;
}
