import { describe, expect, it } from 'vitest';
import { dayKey, formatDayLabel, formatListTime, formatMessageTime } from './chat-format';

// Zeitzone Wien: 23:30 UTC am 26.10. ist bereits der 27.10. (Winterzeit, UTC+1)
const now = new Date('2026-10-27T10:00:00Z');

describe('Zeitangaben im Postfach', () => {
  it('rechnet Kalendertage in Wiener Zeit', () => {
    expect(dayKey('2026-10-26T23:30:00Z')).toBe('2026-10-27');
    expect(formatMessageTime('2026-10-26T23:30:00Z')).toBe('00:30');
  });

  it('zeigt heute die Uhrzeit, dann Gestern, Wochentag und Datum', () => {
    expect(formatListTime('2026-10-27T08:05:00Z', now)).toBe('09:05');
    expect(formatListTime('2026-10-26T08:05:00Z', now)).toBe('Gestern');
    expect(formatListTime('2026-10-23T08:05:00Z', now)).toBe('Freitag');
    expect(formatListTime('2026-10-01T08:05:00Z', now)).toBe('01.10.26');
  });

  it('beschriftet Tagestrenner', () => {
    expect(formatDayLabel('2026-10-27T08:05:00Z', now)).toBe('Heute');
    expect(formatDayLabel('2026-10-26T08:05:00Z', now)).toBe('Gestern');
    expect(formatDayLabel('2026-10-20T08:05:00Z', now)).toBe('Dienstag, 20. Oktober 2026');
  });
});
