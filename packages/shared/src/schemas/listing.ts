import { z } from 'zod';
import { ITEM_CONDITIONS, PRICE_TYPES } from '../enums.js';

/** Obergrenze: 1 Mrd. Euro in Cent – deckt auch Immobilien ab. */
export const MAX_PRICE_CENTS = 100_000_000_000;

export const listingTitleSchema = z
  .string({ error: 'Bitte gib einen Titel ein.' })
  .trim()
  .min(5, 'Der Titel muss mindestens 5 Zeichen lang sein.')
  .max(90, 'Der Titel darf höchstens 90 Zeichen lang sein.');

export const listingDescriptionSchema = z
  .string({ error: 'Bitte gib eine Beschreibung ein.' })
  .trim()
  .min(20, 'Die Beschreibung muss mindestens 20 Zeichen lang sein.')
  .max(5000, 'Die Beschreibung darf höchstens 5000 Zeichen lang sein.');

const priceCentsSchema = z
  .number()
  .int('Der Preis muss in Cent als ganze Zahl übergeben werden.')
  .positive('Der Preis muss größer als 0 sein.')
  .max(MAX_PRICE_CENTS, 'Der Preis ist zu hoch.');

/**
 * Grobe Formprüfung der Zusatzangaben. Welche Felder mit welchen Werten erlaubt sind, hängt von der
 * Kategorie ab und wird in der API mit `parseListingAttributes` geprüft (siehe `attributes/`).
 */
const attributesSchema = z
  .record(
    z.string().max(40),
    z.union([z.string().max(500), z.number(), z.boolean(), z.array(z.string().max(60)).max(30)]),
  )
  .refine((value) => Object.keys(value).length <= 40, 'Zu viele Zusatzangaben.');

/** Felder eines Inserats. Kategorieabhängige Zusatzfelder landen in `attributes`. */
const listingFields = {
  title: listingTitleSchema,
  description: listingDescriptionSchema,
  categoryId: z.string({ error: 'Bitte wähle eine Kategorie.' }).min(1, 'Bitte wähle eine Kategorie.'),
  priceType: z.enum(PRICE_TYPES, { error: 'Bitte wähle eine Preisart.' }),
  priceCents: priceCentsSchema.nullable().optional(),
  condition: z.enum(ITEM_CONDITIONS).nullable().optional(),
  locationId: z.number({ error: 'Bitte gib eine PLZ ein und wähle einen Ort.' }).int().positive('Bitte wähle einen Ort.'),
  attributes: attributesSchema.optional(),
};

function refinePrice(
  value: { priceType?: string; priceCents?: number | null },
  ctx: z.RefinementCtx,
) {
  const needsPrice = value.priceType === 'FIXED' || value.priceType === 'NEGOTIABLE';
  if (needsPrice && (value.priceCents === null || value.priceCents === undefined)) {
    ctx.addIssue({ code: 'custom', path: ['priceCents'], message: 'Bitte gib einen Preis an.' });
  }
}

/** Vollständiges Inserat – wird beim Veröffentlichen geprüft. */
export const listingPublishSchema = z.object(listingFields).superRefine(refinePrice);
export type ListingPublishInput = z.infer<typeof listingPublishSchema>;

/** Entwurf: nur der Titel ist Pflicht, alles andere darf noch fehlen. */
export const listingDraftSchema = z
  .object({
    ...listingFields,
    title: z.string().trim().min(3, 'Der Titel muss mindestens 3 Zeichen lang sein.').max(90),
    description: z.string().trim().max(5000).optional(),
    categoryId: z.string().min(1).optional(),
    priceType: z.enum(PRICE_TYPES).optional(),
    locationId: z.number().int().positive().optional(),
  })
  .partial({ condition: true, priceCents: true, attributes: true });
export type ListingDraftInput = z.infer<typeof listingDraftSchema>;

/** Kennung des Formulars: Wird es erneut abgeschickt (Doppelklick, Verbindungsabbruch), entsteht kein zweites Inserat. */
const clientRequestId = z.uuid().optional();

/** Anlegen: `publish: true` veröffentlicht sofort, sonst wird ein Entwurf gespeichert. */
export const createListingSchema = z.discriminatedUnion('publish', [
  listingPublishSchema.safeExtend({ publish: z.literal(true), clientRequestId }),
  listingDraftSchema.extend({ publish: z.literal(false), clientRequestId }),
]);
export type CreateListingInput = z.infer<typeof createListingSchema>;

export const updateListingSchema = listingDraftSchema.partial();
export type UpdateListingInput = z.infer<typeof updateListingSchema>;

