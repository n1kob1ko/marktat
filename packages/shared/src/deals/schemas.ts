import { z } from '../schemas/zod.js';
import { isSafeExternalUrl } from '../schemas/url.js';
import { isCalendarDay } from './dates.js';
import { DEAL_AVAILABILITIES, DEAL_CHANNELS, DEAL_IMAGE_RIGHTS, MERCHANT_REFERENCE_PRICE_TYPES } from './enums.js';
import { DEAL_MAX_DURATION_DAYS, DEAL_MAX_PRICE_CENTS } from './pricing.js';

/** Prüfziffer einer GTIN/EAN (8, 12, 13 oder 14 Stellen) */
export function isValidGtin(value: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(value)) return false;
  const digits = value.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, digit, i) => acc + digit * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

const optionalText = (max: number, message?: string) =>
  z
    .string()
    .trim()
    .max(max, message ?? `Höchstens ${max} Zeichen.`)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const externalUrlSchema = z
  .string()
  .trim()
  .refine((value) => isSafeExternalUrl(value), 'Bitte gib eine vollständige Adresse mit https:// ein (keine IP-Adressen oder internen Adressen).');

const optionalUrl = externalUrlSchema
  .or(z.literal('').transform(() => null))
  .nullable()
  .optional();

const day = z.string({ error: 'Bitte gib ein Datum an.' }).refine(isCalendarDay, 'Bitte gib ein gültiges Datum an.');

const cents = (label: string) =>
  z
    .number({ error: `Bitte gib ${label} an.` })
    .int(`${label} muss in Cent als ganze Zahl übergeben werden.`)
    .positive(`${label} muss größer als 0 sein.`)
    .max(DEAL_MAX_PRICE_CENTS, `${label} ist zu hoch.`);

/** Felder eines Deals (Formular, Import und Feed verwenden dieselben Regeln) */
export const dealFieldsSchema = z.object({
  title: z
    .string({ error: 'Bitte gib einen Titel ein.' })
    .trim()
    .min(5, 'Der Titel muss mindestens 5 Zeichen lang sein.')
    .max(120, 'Der Titel darf höchstens 120 Zeichen lang sein.'),
  description: z.string().trim().max(3000, 'Die Beschreibung darf höchstens 3000 Zeichen lang sein.').optional(),
  categorySlug: z.string({ error: 'Bitte wähle eine Kategorie.' }).min(1, 'Bitte wähle eine Kategorie.').max(60),
  channel: z.enum(DEAL_CHANNELS, { error: 'Bitte wähle, wo das Angebot gilt.' }),
  url: optionalUrl,
  /** Provisions- bzw. Affiliate-Link: wird als Werbelink gekennzeichnet */
  isAffiliateLink: z.boolean().optional(),
  priceCents: cents('den Angebotspreis'),
  /** Grundpreis, z. B. „€ 2,49 / kg“ */
  unitPriceText: optionalText(40),
  /** Versandkosten bzw. Hinweis, z. B. „zzgl. € 4,90 Versand“ */
  shippingNote: optionalText(120),
  referencePriceCents: cents('den Vergleichspreis').nullable().optional(),
  referencePriceType: z.enum(MERCHANT_REFERENCE_PRICE_TYPES, { error: 'Bitte wähle, worauf sich der Vergleichspreis bezieht.' }).nullable().optional(),
  /** Woher der Vergleichspreis stammt (z. B. „UVP laut Hersteller, Preisliste 10/2026“) */
  referencePriceSource: optionalText(200),
  /** Optionaler Beleg (Herstellerseite, eigene frühere Preisliste) */
  referencePriceEvidenceUrl: optionalUrl,
  availability: z.enum(DEAL_AVAILABILITIES).optional(),
  startsOn: day,
  endsOn: day,
  /** Filialen, in denen das Angebot gilt (lokale Angebote) */
  storeIds: z.array(z.string().min(1).max(40)).max(50, 'Höchstens 50 Filialen je Angebot.').optional(),
  brand: optionalText(60),
  gtin: z
    .string()
    .trim()
    .refine((v) => v === '' || isValidGtin(v), 'Die GTIN/EAN ist ungültig (8, 12, 13 oder 14 Ziffern mit Prüfziffer).')
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  /** Eigene, stabile Angebots- bzw. Artikelnummer des Händlers (für Importe) */
  externalId: z
    .string()
    .trim()
    .max(100)
    .regex(/^[\w.\-/:]*$/, 'Die Artikelnummer darf nur Buchstaben, Ziffern und . - _ / : enthalten.')
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
});
export type DealFields = z.infer<typeof dealFieldsSchema>;

const DAY_MS = 86_400_000;

/** Zusammenhänge zwischen den Feldern; alle Fehler auf einmal */
export function checkDealFields(value: Partial<DealFields>, ctx: z.RefinementCtx) {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if ((value.channel === 'ONLINE' || value.channel === 'BOTH') && !value.url) issue('url', 'Für Online-Angebote brauchen wir den Link zum Angebot.');
  if ((value.channel === 'LOCAL' || value.channel === 'BOTH') && !value.storeIds?.length) issue('storeIds', 'Bitte wähle mindestens eine Filiale, in der das Angebot gilt.');
  if (value.channel === 'LOCAL' && value.isAffiliateLink) issue('isAffiliateLink', 'Affiliate-Links gibt es nur bei Online-Angeboten.');
  const hasReference = value.referencePriceCents !== null && value.referencePriceCents !== undefined;
  if (hasReference && !value.referencePriceType) issue('referencePriceType', 'Bitte gib an, worauf sich der Vergleichspreis bezieht.');
  if (!hasReference && value.referencePriceType) issue('referencePriceCents', 'Bitte gib den Vergleichspreis an oder entferne die Art des Vergleichspreises.');
  if (hasReference && value.priceCents && value.referencePriceCents! <= value.priceCents) {
    issue('referencePriceCents', 'Der Vergleichspreis muss höher sein als der Angebotspreis – sonst lass ihn einfach weg.');
  }
  if (hasReference && value.referencePriceType === 'RRP' && !value.referencePriceSource) {
    issue('referencePriceSource', 'Bitte gib an, woher die unverbindliche Preisempfehlung stammt.');
  }
  if (value.startsOn && value.endsOn && isCalendarDay(value.startsOn) && isCalendarDay(value.endsOn)) {
    const days = (Date.parse(value.endsOn) - Date.parse(value.startsOn)) / DAY_MS;
    if (days < 0) issue('endsOn', 'Das Angebot muss nach dem Beginn enden.');
    else if (days + 1 > DEAL_MAX_DURATION_DAYS) issue('endsOn', `Ein Angebot läuft höchstens ${DEAL_MAX_DURATION_DAYS} Tage. Verlängern kannst du es später.`);
  }
}

/** Vollständiger Deal (Anlegen, Import, Prüfung nach dem Bearbeiten) */
export const dealCompleteSchema = dealFieldsSchema.superRefine(checkDealFields);

/** Bestätigung der Vergleichspreisangabe – Pflicht, sobald ein Vergleichspreis angegeben wird */
const referenceConfirmed = z.boolean().optional();

function requireReferenceConfirmation(value: { referencePriceCents?: number | null; referenceConfirmed?: boolean }, ctx: z.RefinementCtx) {
  if (value.referencePriceCents && value.referenceConfirmed !== true) {
    ctx.addIssue({
      code: 'custom',
      path: ['referenceConfirmed'],
      message: 'Bitte bestätige, dass der Vergleichspreis stimmt und nachvollziehbar ist.',
    });
  }
}

export const createDealSchema = dealFieldsSchema
  .extend({
    /** false = als Entwurf speichern */
    publish: z.boolean(),
    referenceConfirmed,
    clientRequestId: z.uuid().optional(),
  })
  .superRefine((value, ctx) => {
    checkDealFields(value, ctx);
    requireReferenceConfirmation(value, ctx);
  });
export type CreateDealInput = z.infer<typeof createDealSchema>;

/** Bearbeiten: nur geänderte Felder; die API prüft danach den vollständigen Stand. */
export const updateDealSchema = dealFieldsSchema
  .partial()
  .extend({ referenceConfirmed })
  .superRefine(requireReferenceConfirmation);
export type UpdateDealInput = z.infer<typeof updateDealSchema>;

/** Verlängern: neues Enddatum */
export const extendDealSchema = z.object({ endsOn: day });
export type ExtendDealInput = z.infer<typeof extendDealSchema>;

export const dealImageRightsSchema = z.object({
  rights: z.enum(DEAL_IMAGE_RIGHTS, { error: 'Bitte gib an, woher das Bild stammt.' }),
  credit: optionalText(120),
});

/** Filiale eines Händlers (für lokale Angebote) */
export const dealerStoreSchema = z.object({
  name: z.string({ error: 'Bitte gib einen Namen ein.' }).trim().min(2, 'Der Name muss mindestens 2 Zeichen lang sein.').max(120),
  street: z.string({ error: 'Bitte gib die Adresse ein.' }).trim().min(3, 'Bitte gib Straße und Hausnummer ein.').max(200),
  locationId: z.number({ error: 'Bitte gib eine PLZ ein und wähle einen Ort.' }).int().positive('Bitte wähle einen Ort.'),
  openingHours: optionalText(300),
});
export type DealerStoreInput = z.infer<typeof dealerStoreSchema>;

/** Einmalige Bestätigung gewerblicher Anbieter (Art. 30 DSA), bevor Deals veröffentlicht werden können */
export const dealerCertificationSchema = z.object({
  confirmed: z.literal(true, { error: 'Bitte bestätige die Angaben.' }),
});
