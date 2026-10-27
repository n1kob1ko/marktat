import { z } from './zod.js';
import { BILLING_MODES, BOOKING_STATUSES, PAID_MODE_CONFIRMATION, PRODUCT_CODES } from '../billing.js';
import { CONTROL_CHARS } from './interactions.js';

const text = (min: number, max: number, minMessage: string) =>
  z
    .string({ error: minMessage })
    .transform((v) => v.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').trim())
    .pipe(z.string().min(min, minMessage).max(max, `Höchstens ${max.toLocaleString('de-AT')} Zeichen.`));

/** Höchstbetrag je Leistung: 1.000 € – schützt vor Tippfehlern (z. B. Euro statt Cent) */
export const MAX_PRODUCT_PRICE_CENTS = 100_000;

const cents = z
  .number({ error: 'Bitte gib einen Betrag ein.' })
  .int('Bitte gib einen Betrag in ganzen Cent ein.')
  .min(0, 'Der Betrag darf nicht negativ sein.')
  .max(MAX_PRODUCT_PRICE_CENTS, 'Höchstens € 1.000,00 je Leistung.');

const limit = (max: number) =>
  z.number().int('Bitte gib eine ganze Zahl ein.').min(0, 'Der Wert darf nicht negativ sein.').max(max, `Höchstens ${max.toLocaleString('de-AT')}.`).nullable();

const instant = z.iso.datetime({ offset: true, error: 'Bitte gib ein gültiges Datum ein.' }).nullable();

function endAfterStart(start: string | null, end: string | null, path: string, ctx: z.RefinementCtx) {
  if (start && end && new Date(end) <= new Date(start)) {
    ctx.addIssue({ code: 'custom', path: [path], message: 'Das Ende muss nach dem Beginn liegen.' });
  }
}

/** Leistung bearbeiten (Admin). Vollständiger Stand; `expectedUpdatedAt` verhindert, dass gleichzeitige Änderungen verloren gehen. */
export const updateProductSchema = z
  .object({
    name: text(2, 80, 'Bitte gib einen Namen ein.'),
    description: text(0, 500, 'Bitte gib eine Beschreibung ein.'),
    priceCents: cents,
    plannedPriceCents: cents.nullable(),
    durationDays: z.number().int('Bitte gib ganze Tage ein.').min(1, 'Mindestens 1 Tag.').max(365, 'Höchstens 365 Tage.').nullable(),
    forPrivate: z.boolean(),
    forBusiness: z.boolean(),
    isActive: z.boolean(),
    paidEnabled: z.boolean(),
    promoStartsAt: instant,
    promoEndsAt: instant,
    maxActivePerUser: limit(1000),
    maxActiveTotal: limit(100_000),
    maxPerPeriod: limit(1000),
    periodDays: z.number().int().min(1, 'Mindestens 1 Tag.').max(365, 'Höchstens 365 Tage.'),
    cooldownHours: limit(720),
    expectedUpdatedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, ctx) => {
    endAfterStart(value.promoStartsAt, value.promoEndsAt, 'promoEndsAt', ctx);
    if (!value.forPrivate && !value.forBusiness) {
      ctx.addIssue({ code: 'custom', path: ['forPrivate'], message: 'Die Leistung muss für mindestens eine Kontoart verfügbar sein.' });
    }
  });
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

/** Einführungsaktion und allgemeine Schutzgrenzen (Admin) */
export const updateBillingSettingsSchema = z
  .object({
    introEnabled: z.boolean(),
    introVisible: z.boolean(),
    introTitle: text(3, 80, 'Bitte gib einen Titel ein (mindestens 3 Zeichen).'),
    introDescription: text(10, 400, 'Bitte gib eine Beschreibung ein (mindestens 10 Zeichen).'),
    introStartsAt: instant,
    introEndsAt: instant,
    introShowPlannedPrice: z.boolean(),
    maxBookingsPerHour: z.number().int().min(1, 'Mindestens 1.').max(1000, 'Höchstens 1.000.'),
  })
  .strict()
  .superRefine((value, ctx) => endAfterStart(value.introStartsAt, value.introEndsAt, 'introEndsAt', ctx));
export type UpdateBillingSettingsInput = z.infer<typeof updateBillingSettingsSchema>;

/** Betriebsmodus wechseln. Für den kostenpflichtigen Betrieb ist eine wörtliche Bestätigung Pflicht. */
export const billingModeSchema = z
  .object({
    mode: z.enum(BILLING_MODES, { error: 'Bitte wähle einen Betriebsmodus.' }),
    confirmation: z.string().max(40).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === 'PAID' && value.confirmation?.trim() !== PAID_MODE_CONFIRMATION) {
      ctx.addIssue({ code: 'custom', path: ['confirmation'], message: `Bitte tippe ${PAID_MODE_CONFIRMATION} zur Bestätigung ein.` });
    }
  });
export type BillingModeInput = z.infer<typeof billingModeSchema>;

/** Leistung für ein eigenes Inserat buchen. Preis und Laufzeit bestimmt ausschließlich der Server. */
export const createBookingSchema = z
  .object({
    product: z.enum(PRODUCT_CODES, { error: 'Diese Leistung gibt es nicht.' }),
    /** Einmal je Formular erzeugt – doppeltes Absenden legt keine zweite Buchung an */
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, 'Ungültiger Schlüssel.'),
  })
  .strict();
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

const page = z.coerce.number().int().min(1).max(1000).default(1);
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((v) => ((values as readonly string[]).includes(v ?? '') ? (v as T[number]) : undefined));

export const adminBookingQuerySchema = z.object({
  status: optionalEnum(BOOKING_STATUSES),
  product: optionalEnum(PRODUCT_CODES),
  /** nur kostenpflichtige (Preis > 0) bzw. kostenlose Buchungen */
  price: optionalEnum(['paid', 'free'] as const),
  page,
});
export type AdminBookingQuery = z.infer<typeof adminBookingQuerySchema>;

/** Aufruf einer Inseratsseite (vom Browser gemeldet, serverseitig dedupliziert) */
export const listingViewSchema = z
  .object({
    /** Pseudonymer Besucherschlüssel des Web-Servers (Hash, keine IP) */
    visitor: z.string().regex(/^[a-f0-9]{32,64}$/),
  })
  .strict();
export type ListingViewInput = z.infer<typeof listingViewSchema>;
