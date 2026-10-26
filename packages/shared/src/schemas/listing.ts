import { z } from 'zod';
import { ITEM_CONDITIONS, PRICE_TYPES } from '../enums.js';

/** Obergrenze: 1 Mrd. Euro in Cent – deckt auch Immobilien ab. */
export const MAX_PRICE_CENTS = 100_000_000_000;

export const listingTitleSchema = z
  .string()
  .trim()
  .min(5, 'Der Titel muss mindestens 5 Zeichen lang sein.')
  .max(90, 'Der Titel darf höchstens 90 Zeichen lang sein.');

export const listingDescriptionSchema = z
  .string()
  .trim()
  .min(20, 'Die Beschreibung muss mindestens 20 Zeichen lang sein.')
  .max(5000, 'Die Beschreibung darf höchstens 5000 Zeichen lang sein.');

const priceCentsSchema = z
  .number()
  .int('Der Preis muss in Cent als ganze Zahl übergeben werden.')
  .positive('Der Preis muss größer als 0 sein.')
  .max(MAX_PRICE_CENTS, 'Der Preis ist zu hoch.');

/**
 * Felder eines Inserats. Kategorieabhängige Zusatzfelder landen in `attributes`
 * und werden serverseitig gegen das Attribut-Schema der Kategorie geprüft (ab Phase 2/5).
 */
const listingFields = {
  title: listingTitleSchema,
  description: listingDescriptionSchema,
  categoryId: z.string().min(1, 'Bitte wähle eine Kategorie.'),
  priceType: z.enum(PRICE_TYPES),
  priceCents: priceCentsSchema.nullable().optional(),
  condition: z.enum(ITEM_CONDITIONS).nullable().optional(),
  locationId: z.number().int().positive('Bitte wähle einen Ort.'),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
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

/** Anlegen: `publish: true` veröffentlicht sofort, sonst wird ein Entwurf gespeichert. */
export const createListingSchema = z.discriminatedUnion('publish', [
  listingPublishSchema.safeExtend({ publish: z.literal(true) }),
  listingDraftSchema.extend({ publish: z.literal(false) }),
]);
export type CreateListingInput = z.infer<typeof createListingSchema>;

export const updateListingSchema = listingDraftSchema.partial();
export type UpdateListingInput = z.infer<typeof updateListingSchema>;

export const listingQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: z.string().optional(),
  state: z.string().optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(24),
});
export type ListingQuery = z.infer<typeof listingQuerySchema>;
