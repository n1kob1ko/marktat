import { describe, expect, it } from 'vitest';
import { accountDeletionSchema, adminReportQuerySchema, listingDecisionSchema, reportListingSchema, userDecisionSchema } from './moderation.js';
import { reportUserSchema } from './interactions.js';

const version = '2026-10-27T10:00:00.000Z';

describe('Meldungen', () => {
  it('verlangt Grund, Begründung und Bestätigung nach Treu und Glauben', () => {
    expect(reportListingSchema.safeParse({ reason: 'FRAUD', details: 'Vorkasse per Gutschein verlangt', goodFaith: true }).success).toBe(true);
    expect(reportListingSchema.safeParse({ reason: 'FRAUD', details: 'kurz', goodFaith: true }).success).toBe(false);
    expect(reportListingSchema.safeParse({ reason: 'FRAUD', details: 'Vorkasse per Gutschein verlangt', goodFaith: false }).success).toBe(false);
    expect(reportListingSchema.safeParse({ reason: 'FRAUD', details: 'Vorkasse per Gutschein verlangt', goodFaith: true, status: 'RESOLVED' }).success).toBe(false);
  });

  it('entfernt Steuerzeichen aus der Begründung', () => {
    const parsed = reportListingSchema.parse({ reason: 'SPAM', details: '  Spam‮anzeige mehrfach  ', goodFaith: true });
    expect(parsed.details).toBe('Spamanzeige mehrfach');
  });

  it('erlaubt in Unterhaltungen nur passende Gründe', () => {
    expect(reportUserSchema.safeParse({ reason: 'HARASSMENT' }).success).toBe(true);
    expect(reportUserSchema.safeParse({ reason: 'PROHIBITED_ITEM' }).success).toBe(false);
  });
});

describe('Moderationsentscheidungen', () => {
  it('verlangt für Maßnahmen Grund und Rechtsgrundlage, für Freigaben nicht', () => {
    const statement = 'Begründung mit ausreichend vielen Zeichen.';
    const reject = listingDecisionSchema.safeParse({ decision: 'REJECT', statement, version });
    expect(reject.success).toBe(false);
    expect(reject.error?.issues.map((i) => i.path[0]).sort()).toEqual(['ground', 'reason']);
    expect(listingDecisionSchema.safeParse({ decision: 'REJECT', reason: 'FRAUD', ground: 'TERMS', statement, version }).success).toBe(true);
    expect(listingDecisionSchema.safeParse({ decision: 'RESTORE', statement, version }).success).toBe(true);
    expect(listingDecisionSchema.safeParse({ decision: 'RESTORE', statement }).success).toBe(false);
    expect(userDecisionSchema.safeParse({ decision: 'SUSPEND', statement }).success).toBe(false);
    expect(userDecisionSchema.safeParse({ decision: 'RESTORE', statement }).success).toBe(true);
  });
});

describe('Kontolöschung', () => {
  it('akzeptiert das Bestätigungswort unabhängig von Groß- und Kleinschreibung', () => {
    expect(accountDeletionSchema.safeParse({ password: 'x', confirmation: ' löschen ' }).success).toBe(true);
    expect(accountDeletionSchema.safeParse({ password: 'x', confirmation: 'ja' }).success).toBe(false);
    expect(accountDeletionSchema.safeParse({ password: '', confirmation: 'LÖSCHEN' }).success).toBe(false);
  });
});

describe('Filter im Admin-Bereich', () => {
  it('ignoriert unbekannte Werte und nutzt sinnvolle Standards', () => {
    expect(adminReportQuerySchema.parse({ status: 'EGAL', priority: 'x', page: '2' })).toMatchObject({ status: 'active', priority: undefined, page: 2 });
  });
});
