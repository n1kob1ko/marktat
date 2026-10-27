import { describe, expect, it } from 'vitest';
import { billingModeSchema, createBookingSchema, updateBillingSettingsSchema, updateProductSchema } from './schemas/billing.js';
import { effectivePrice, formatAmountCents, introOffer, isWithinWindow, type IntroSettings } from './billing.js';

const now = new Date('2026-11-15T12:00:00Z');
const paidProduct = { priceCents: 490, paidEnabled: true, promoStartsAt: null, promoEndsAt: null };

describe('effectivePrice', () => {
  it('ist im kostenlosen Betrieb immer 0 – auch mit Preis und Freigabe', () => {
    expect(effectivePrice(paidProduct, 'FREE', now)).toEqual({ priceCents: 0, reason: 'free_mode', requiresPayment: false });
  });

  it('verlangt im kostenpflichtigen Betrieb nur bei freigegebener Leistung mit Preis eine Zahlung', () => {
    expect(effectivePrice({ ...paidProduct, paidEnabled: false }, 'PAID', now).requiresPayment).toBe(false);
    expect(effectivePrice({ ...paidProduct, priceCents: 0 }, 'PAID', now).reason).toBe('zero_price');
    expect(effectivePrice(paidProduct, 'PAID', now)).toEqual({ priceCents: 490, reason: 'paid', requiresPayment: true });
  });

  it('ist im Aktionszeitraum kostenlos; nach dem Ende gilt der Preis nur im kostenpflichtigen Betrieb', () => {
    const promo = { ...paidProduct, promoStartsAt: '2026-11-01T00:00:00Z', promoEndsAt: '2026-12-01T00:00:00Z' };
    expect(effectivePrice(promo, 'PAID', now).reason).toBe('promotion');
    const afterPromo = new Date('2026-12-02T00:00:00Z');
    // Ende der Aktion schaltet im kostenlosen Betrieb nichts frei
    expect(effectivePrice(promo, 'FREE', afterPromo).requiresPayment).toBe(false);
    expect(effectivePrice(promo, 'PAID', afterPromo).requiresPayment).toBe(true);
  });
});

describe('isWithinWindow', () => {
  it('behandelt fehlende Grenzen als offen und das Ende als ausschließlich', () => {
    expect(isWithinWindow(null, null, now)).toBe(true);
    expect(isWithinWindow('2026-11-16T00:00:00Z', null, now)).toBe(false);
    expect(isWithinWindow(null, now.toISOString(), now)).toBe(false);
  });
});

describe('introOffer', () => {
  const settings: IntroSettings = {
    introEnabled: true,
    introVisible: true,
    introTitle: 'Jetzt kostenlos inserieren',
    introDescription: 'Während unserer Einführungsphase kannst du kostenlos inserieren.',
    introStartsAt: null,
    introEndsAt: null,
    introShowPlannedPrice: false,
  };
  const listing = { priceCents: 0, paidEnabled: false, plannedPriceCents: 290, promoStartsAt: null, promoEndsAt: null };

  it('zeigt ohne Enddatum keine Befristung und den geplanten Preis nur auf Wunsch', () => {
    expect(introOffer(settings, listing, 'FREE', now)).toEqual({
      title: 'Jetzt kostenlos inserieren',
      description: settings.introDescription,
      endsAt: null,
      plannedPriceCents: null,
    });
    expect(introOffer({ ...settings, introShowPlannedPrice: true }, listing, 'FREE', now)?.plannedPriceCents).toBe(290);
  });

  it('nennt ein festgelegtes Enddatum und verschwindet danach', () => {
    const withEnd = { ...settings, introEndsAt: '2026-12-01T00:00:00Z' };
    expect(introOffer(withEnd, listing, 'FREE', now)?.endsAt).toBe('2026-12-01T00:00:00.000Z');
    expect(introOffer(withEnd, listing, 'FREE', new Date('2026-12-01T00:00:01Z'))).toBeNull();
  });

  it('erscheint nicht, wenn sie ausgeschaltet oder unsichtbar ist oder Inserate etwas kosten', () => {
    expect(introOffer({ ...settings, introVisible: false }, listing, 'FREE', now)).toBeNull();
    expect(introOffer({ ...settings, introEnabled: false }, listing, 'FREE', now)).toBeNull();
    expect(introOffer(settings, { ...listing, priceCents: 290, paidEnabled: true }, 'PAID', now)).toBeNull();
  });
});

describe('Schemas', () => {
  const product = {
    name: 'Top-Anzeige',
    description: 'Oben in passenden Suchergebnissen.',
    priceCents: 0,
    plannedPriceCents: 990,
    durationDays: 7,
    forPrivate: true,
    forBusiness: true,
    isActive: true,
    paidEnabled: false,
    promoStartsAt: null,
    promoEndsAt: null,
    maxActivePerUser: 2,
    maxActiveTotal: 200,
    maxPerPeriod: 4,
    periodDays: 30,
    cooldownHours: null,
    expectedUpdatedAt: '2026-10-28T09:00:00.000Z',
  };

  it('lehnt negative, gebrochene und zu hohe Preise ab', () => {
    expect(updateProductSchema.safeParse(product).success).toBe(true);
    expect(updateProductSchema.safeParse({ ...product, priceCents: -1 }).success).toBe(false);
    expect(updateProductSchema.safeParse({ ...product, priceCents: 1.5 }).success).toBe(false);
    expect(updateProductSchema.safeParse({ ...product, priceCents: 100_001 }).success).toBe(false);
    expect(updateProductSchema.safeParse({ ...product, forPrivate: false, forBusiness: false }).success).toBe(false);
    expect(updateProductSchema.safeParse({ ...product, promoStartsAt: '2026-12-01T00:00:00Z', promoEndsAt: '2026-11-01T00:00:00Z' }).success).toBe(false);
  });

  it('verlangt für den kostenpflichtigen Betrieb die wörtliche Bestätigung', () => {
    expect(billingModeSchema.safeParse({ mode: 'PAID' }).success).toBe(false);
    expect(billingModeSchema.safeParse({ mode: 'PAID', confirmation: 'ja' }).success).toBe(false);
    expect(billingModeSchema.safeParse({ mode: 'PAID', confirmation: 'KOSTENPFLICHTIG' }).success).toBe(true);
    expect(billingModeSchema.safeParse({ mode: 'FREE' }).success).toBe(true);
  });

  it('nimmt bei Buchungen keinen Preis vom Client an', () => {
    expect(createBookingSchema.safeParse({ product: 'top', idempotencyKey: 'a'.repeat(32) }).success).toBe(true);
    expect(createBookingSchema.safeParse({ product: 'top', idempotencyKey: 'a'.repeat(32), priceCents: 0 }).success).toBe(false);
    expect(createBookingSchema.safeParse({ product: 'gold', idempotencyKey: 'a'.repeat(32) }).success).toBe(false);
  });

  it('prüft die Einführungsaktion', () => {
    const base = {
      introEnabled: true,
      introVisible: true,
      introTitle: 'Gratis',
      introDescription: 'Kostenlos inserieren während der Einführung.',
      introStartsAt: null,
      introEndsAt: null,
      introShowPlannedPrice: false,
      maxBookingsPerHour: 20,
    };
    expect(updateBillingSettingsSchema.safeParse(base).success).toBe(true);
    expect(updateBillingSettingsSchema.safeParse({ ...base, introStartsAt: '2026-12-01T00:00:00Z', introEndsAt: '2026-11-01T00:00:00Z' }).success).toBe(false);
  });
});

describe('formatAmountCents', () => {
  it('zeigt immer Cent', () => {
    expect(formatAmountCents(0).replace(/\s/g, ' ')).toBe('€ 0,00');
    expect(formatAmountCents(490).replace(/\s/g, ' ')).toBe('€ 4,90');
  });
});
