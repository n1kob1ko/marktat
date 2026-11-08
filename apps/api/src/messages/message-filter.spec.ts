import { describe, expect, it } from 'vitest';
import { containsLink, isMassMessage, isNewAccount, normalizeForComparison } from './message-filter.js';

describe('Spam-Filter für Nachrichten', () => {
  it('erkennt Links und Domains, aber keine Abkürzungen oder Ortsangaben', () => {
    for (const text of ['Zahl bitte hier: https://zahlung-sicher.example/abc', 'Schau auf www.billig-kaufen.at', 'Infos unter mein-shop.at/angebot', 'Schreib mir auf telegram.me/nutzer']) {
      expect(containsLink(text), text).toBe(true);
    }
    for (const text of ['Hallo, ist das Rad noch zu haben? Abholung in 8010 Graz.', 'Ich zahle z.B. per Überweisung.', 'Preisvorschlag: 300 Euro, ggf. mehr.', 'Komme ca. 18.30 Uhr vorbei']) {
      expect(containsLink(text), text).toBe(false);
    }
  });

  it('unterscheidet neue und etablierte Konten', () => {
    const now = new Date('2026-11-08T12:00:00Z');
    expect(isNewAccount(new Date('2026-11-08T01:00:00Z'), now)).toBe(true);
    expect(isNewAccount(new Date('2026-11-06T12:00:00Z'), now)).toBe(false);
  });

  it('erkennt dieselbe Nachricht an mehrere Anbieter trotz kleiner Abweichungen', () => {
    expect(normalizeForComparison('Hallo!! Ist das noch  zu haben?')).toBe('hallo ist das noch zu haben');
    const body = 'Guten Tag, ich interessiere mich sehr für Ihr Angebot und würde gerne sofort kaufen.';
    const recent = [
      { body, conversationId: 'a' },
      { body: body.toUpperCase(), conversationId: 'b' },
      { body: `${body}!!!`, conversationId: 'c' },
    ];
    expect(isMassMessage(body, recent)).toBe(true);
    // Dieselbe Unterhaltung zählt nur einmal; die aktuelle Unterhaltung wird ausgenommen
    expect(isMassMessage(body, [recent[0]!, recent[0]!, recent[1]!])).toBe(false);
    expect(isMassMessage(body, recent, 'c')).toBe(false);
    // Kurze Standardfragen sind kein Massenanschreiben
    expect(isMassMessage('Noch zu haben?', [{ body: 'Noch zu haben?', conversationId: 'a' }, { body: 'Noch zu haben?', conversationId: 'b' }, { body: 'Noch zu haben?', conversationId: 'c' }])).toBe(false);
  });
});
