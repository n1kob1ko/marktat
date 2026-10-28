import { describe, expect, it } from 'vitest';
import { registerSchema } from './auth.js';
import { createImageUploadSchema, MAX_IMAGE_BYTES, reorderImagesSchema } from './image.js';
import {
  createSavedSearchSchema,
  normalizeMessageBody,
  notificationSettingsSchema,
  reportUserSchema,
  sendMessageSchema,
  updateSavedSearchSchema,
} from './interactions.js';
import { createListingSchema, listingPublishSchema } from './listing.js';
import { updateProfileSchema } from './profile.js';

const validListing = {
  title: 'Gut erhaltenes Citybike',
  description: 'Damenrad, 28 Zoll, 7-Gang-Nabenschaltung, frisch serviciert.',
  categoryId: 'cat_1',
  priceType: 'NEGOTIABLE' as const,
  priceCents: 15000,
  locationId: 1,
};

describe('registerSchema', () => {
  const base = {
    email: ' Max@Example.at ',
    password: 'sicheresPasswort1',
    displayName: 'Max',
    accountType: 'PRIVATE' as const,
    acceptTerms: true as const,
  };

  it('normalisiert die E-Mail-Adresse', () => {
    expect(registerSchema.parse(base).email).toBe('max@example.at');
  });
  it('verlangt einen Firmennamen für gewerbliche Konten', () => {
    const result = registerSchema.safeParse({ ...base, accountType: 'BUSINESS' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['companyName']);
  });
  it('lehnt zu kurze Passwörter ab', () => {
    expect(registerSchema.safeParse({ ...base, password: 'kurz1' }).success).toBe(false);
  });
  it('verlangt die Zustimmung zu den Bedingungen', () => {
    expect(registerSchema.safeParse({ ...base, acceptTerms: false }).success).toBe(false);
  });
});

describe('listing schemas', () => {
  it('akzeptiert ein vollständiges Inserat', () => {
    expect(listingPublishSchema.safeParse(validListing).success).toBe(true);
  });
  it('verlangt einen Preis bei Fixpreis/VB', () => {
    const result = listingPublishSchema.safeParse({ ...validListing, priceCents: null });
    expect(result.success).toBe(false);
  });
  it('erlaubt „Zu verschenken“ ohne Preis', () => {
    const result = listingPublishSchema.safeParse({
      ...validListing,
      priceType: 'FREE',
      priceCents: null,
    });
    expect(result.success).toBe(true);
  });
  it('erlaubt Entwürfe mit nur einem Titel', () => {
    expect(createListingSchema.safeParse({ publish: false, title: 'Sofa' }).success).toBe(true);
  });
  it('prüft beim Veröffentlichen alle Pflichtfelder', () => {
    expect(createListingSchema.safeParse({ publish: true, title: 'Sofa' }).success).toBe(false);
    expect(createListingSchema.safeParse({ publish: true, ...validListing }).success).toBe(true);
  });
});

describe('updateProfileSchema', () => {
  it('prüft das Format der UID-Nummer', () => {
    expect(updateProfileSchema.safeParse({ vatId: 'atu12345678' }).data?.vatId).toBe(
      'ATU12345678',
    );
    expect(updateProfileSchema.safeParse({ vatId: 'DE123' }).success).toBe(false);
  });
  it('wandelt leere Felder in null um', () => {
    expect(updateProfileSchema.parse({ bio: '' }).bio).toBeNull();
  });
});

describe('Bild-Schemas', () => {
  it('erlaubt JPEG, PNG und WebP bis 15 MB', () => {
    for (const contentType of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(createImageUploadSchema.safeParse({ contentType, size: MAX_IMAGE_BYTES }).success).toBe(true);
    }
    expect(createImageUploadSchema.safeParse({ contentType: 'image/gif', size: 100 }).success).toBe(false);
    expect(createImageUploadSchema.safeParse({ contentType: 'image/svg+xml', size: 100 }).success).toBe(false);
    expect(createImageUploadSchema.safeParse({ contentType: 'image/jpeg', size: MAX_IMAGE_BYTES + 1 }).success).toBe(false);
    expect(createImageUploadSchema.safeParse({ contentType: 'image/jpeg', size: 0 }).success).toBe(false);
  });

  it('verlangt eine Reihenfolge ohne doppelte Bilder und höchstens 10 Einträge', () => {
    expect(reorderImagesSchema.safeParse({ imageIds: ['a', 'b'] }).success).toBe(true);
    expect(reorderImagesSchema.safeParse({ imageIds: ['a', 'a'] }).success).toBe(false);
    expect(reorderImagesSchema.safeParse({ imageIds: Array.from({ length: 11 }, (_, i) => `id${i}`) }).success).toBe(false);
  });
});

describe('Nachrichten', () => {
  it('vereinheitlicht Zeilenumbrüche und entfernt Steuer- und Richtungszeichen', () => {
    expect(normalizeMessageBody('  Hallo\r\nWelt\u0007 \r\n\r\n\r\n\r\nBis bald\u202e  ')).toBe('Hallo\nWelt\n\nBis bald');
  });

  it('lässt HTML als Text stehen', () => {
    expect(sendMessageSchema.parse({ body: '<b>fett</b>' }).body).toBe('<b>fett</b>');
  });

  it('lehnt leere, zu lange und erweiterte Nachrichten ab', () => {
    expect(sendMessageSchema.safeParse({ body: ' \n ' }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ body: 'x'.repeat(2001) }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ body: 'x'.repeat(2000) }).success).toBe(true);
    expect(sendMessageSchema.safeParse({ body: 'Hallo', recipientId: 'x' }).success).toBe(false);
  });
});

describe('Gespeicherte Suchen', () => {
  it('bereinigt Namen und Beschreibungen', () => {
    const parsed = createSavedSearchSchema.parse({ name: '  BMW\n 3er ', params: { q: 'BMW' }, labels: ['  bis 20.000 € ', ''] });
    expect(parsed).toEqual({ kind: 'LISTINGS', name: 'BMW 3er', params: { q: 'BMW' }, labels: ['bis 20.000 €'], notify: false });
  });

  it('kennt die Arten Anzeigen, Deals und Dienstleistungen', () => {
    expect(createSavedSearchSchema.parse({ kind: 'DEALS', name: 'x', params: { q: 'x' } }).kind).toBe('DEALS');
    expect(createSavedSearchSchema.parse({ kind: 'SERVICES', name: 'x', params: { q: 'x' } }).kind).toBe('SERVICES');
    expect(createSavedSearchSchema.safeParse({ kind: 'JOBS', name: 'x', params: { q: 'x' } }).success).toBe(false);
  });

  it('begrenzt Name und Parameter', () => {
    expect(createSavedSearchSchema.safeParse({ name: '', params: { q: 'x' } }).success).toBe(false);
    expect(createSavedSearchSchema.safeParse({ name: 'x'.repeat(81), params: { q: 'x' } }).success).toBe(false);
    expect(createSavedSearchSchema.safeParse({ name: 'x', params: { q: 'x'.repeat(501) } }).success).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`k${i}`, 'v']));
    expect(createSavedSearchSchema.safeParse({ name: 'x', params: many }).success).toBe(false);
  });

  it('verlangt beim Ändern mindestens ein Feld', () => {
    expect(updateSavedSearchSchema.safeParse({}).success).toBe(false);
    expect(updateSavedSearchSchema.safeParse({ notify: true }).success).toBe(true);
  });
});

describe('Benachrichtigungen und Meldungen', () => {
  it('erlaubt nur die beiden Schalter', () => {
    expect(notificationSettingsSchema.safeParse({ notifyMessagesByEmail: false }).success).toBe(true);
    expect(notificationSettingsSchema.safeParse({ role: 'ADMIN' }).success).toBe(false);
  });

  it('prüft Grund und Länge einer Meldung', () => {
    expect(reportUserSchema.parse({ reason: 'SPAM', details: '  ' })).toEqual({ reason: 'SPAM' });
    expect(reportUserSchema.safeParse({ reason: 'UNBEKANNT' }).success).toBe(false);
    expect(reportUserSchema.safeParse({ reason: 'OTHER', details: 'x'.repeat(1001) }).success).toBe(false);
  });
});
