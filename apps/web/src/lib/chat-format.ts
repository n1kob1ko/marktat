/** Zeitangaben im Postfach. Feste Zeitzone, damit Server und Browser dasselbe anzeigen. */
const TIME_ZONE = 'Europe/Vienna';

const time = new Intl.DateTimeFormat('de-AT', { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE });
const shortDate = new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: TIME_ZONE });
const weekday = new Intl.DateTimeFormat('de-AT', { weekday: 'long', timeZone: TIME_ZONE });
const longDate = new Intl.DateTimeFormat('de-AT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TIME_ZONE });
const dayKeyFormat = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TIME_ZONE });

/** Kalendertag in Wien, z. B. „2026-10-27“ */
export function dayKey(value: string | Date): string {
  return dayKeyFormat.format(typeof value === 'string' ? new Date(value) : value);
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Uhrzeit einer Nachricht */
export function formatMessageTime(value: string): string {
  return time.format(new Date(value));
}

/** Kurze Angabe in der Liste: heute die Uhrzeit, dann „Gestern“, Wochentag, Datum */
export function formatListTime(value: string, now = new Date()): string {
  const diff = daysBetween(dayKey(value), dayKey(now));
  if (diff <= 0) return time.format(new Date(value));
  if (diff === 1) return 'Gestern';
  if (diff < 7) return weekday.format(new Date(value));
  return shortDate.format(new Date(value));
}

/** Trenner zwischen Tagen im Chat */
export function formatDayLabel(value: string, now = new Date()): string {
  const diff = daysBetween(dayKey(value), dayKey(now));
  if (diff <= 0) return 'Heute';
  if (diff === 1) return 'Gestern';
  return longDate.format(new Date(value));
}
