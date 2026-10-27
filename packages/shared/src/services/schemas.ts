import { z } from '../schemas/zod.js';
import { externalUrlSchema } from '../deals/schemas.js';
import {
  PORTFOLIO_IMAGE_RIGHTS,
  SERVICE_AVAILABILITIES,
  SERVICE_MAX_CATEGORIES,
  SERVICE_MAX_PRICE_CENTS,
  SERVICE_MAX_SKILLS,
  SERVICE_PRICE_TYPES,
} from './enums.js';
import { serviceCategoryBySlug } from './categories.js';

const optionalUrl = externalUrlSchema
  .or(z.literal('').transform(() => null))
  .nullable()
  .optional();

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Höchstens ${max} Zeichen.`)
    .transform((v) => v || null)
    .nullable()
    .optional();

export const serviceCategorySlugsSchema = z
  .array(z.string().refine((slug) => Boolean(serviceCategoryBySlug(slug)), 'Unbekannte Kategorie.'), { error: 'Bitte wähle mindestens eine Kategorie.' })
  .min(1, 'Bitte wähle mindestens eine Kategorie.')
  .max(SERVICE_MAX_CATEGORIES, `Höchstens ${SERVICE_MAX_CATEGORIES} Kategorien.`)
  .transform((slugs) => [...new Set(slugs)]);

export const serviceSkillsSchema = z
  .array(z.string().trim().min(2, 'Mindestens 2 Zeichen je Fähigkeit.').max(40, 'Höchstens 40 Zeichen je Fähigkeit.'))
  .max(SERVICE_MAX_SKILLS, `Höchstens ${SERVICE_MAX_SKILLS} Fähigkeiten.`)
  .transform((skills) => skills.filter((skill, i) => skills.findIndex((other) => other.toLowerCase() === skill.toLowerCase()) === i));

/** Anbieterprofil – Erweiterung des bestehenden Kontos (keine eigene Registrierung) */
export const serviceProfileSchema = z
  .object({
    headline: z.string({ error: 'Bitte gib eine Überschrift ein.' }).trim().min(5, 'Mindestens 5 Zeichen.').max(120, 'Höchstens 120 Zeichen.'),
    summary: z.string({ error: 'Bitte gib eine Kurzbeschreibung ein.' }).trim().min(20, 'Mindestens 20 Zeichen.').max(300, 'Höchstens 300 Zeichen.'),
    description: z.string({ error: 'Bitte beschreibe dein Angebot.' }).trim().min(50, 'Mindestens 50 Zeichen.').max(5000, 'Höchstens 5000 Zeichen.'),
    categorySlugs: serviceCategorySlugsSchema,
    skills: serviceSkillsSchema.default([]),
    locationId: z.number().int().positive().nullable().optional(),
    serviceRadiusKm: z.number().int().min(1).max(500).nullable().optional(),
    austriaWide: z.boolean().default(false),
    remote: z.boolean().default(false),
    priceType: z.enum(SERVICE_PRICE_TYPES, { error: 'Bitte wähle die Preisangabe.' }),
    priceCents: z.number().int().positive('Der Betrag muss größer als 0 sein.').max(SERVICE_MAX_PRICE_CENTS, 'Der Betrag ist zu hoch.').nullable().optional(),
    experienceYears: z.number().int().min(0).max(60, 'Höchstens 60 Jahre.').nullable().optional(),
    website: optionalUrl,
    availability: z.enum(SERVICE_AVAILABILITIES).default('AVAILABLE'),
    availabilityNote: optionalText(160),
  })
  .superRefine((value, ctx) => {
    if (value.priceType !== 'ON_REQUEST' && !value.priceCents) {
      ctx.addIssue({ code: 'custom', path: ['priceCents'], message: 'Bitte gib den Betrag an oder wähle „Auf Anfrage“.' });
    }
    if (!value.locationId && !value.austriaWide && !value.remote) {
      ctx.addIssue({ code: 'custom', path: ['locationId'], message: 'Bitte gib deinen Ort an oder wähle „österreichweit“ bzw. „remote“.' });
    }
  })
  .transform((value) => ({ ...value, priceCents: value.priceType === 'ON_REQUEST' ? null : (value.priceCents ?? null), serviceRadiusKm: value.locationId ? (value.serviceRadiusKm ?? null) : null }));
export type ServiceProfileInput = z.input<typeof serviceProfileSchema>;
export type ServiceProfileFields = z.output<typeof serviceProfileSchema>;

export const servicePublishSchema = z.object({
  /** Bestätigung: eigene Angaben, keine erfundenen Bewertungen oder Auszeichnungen */
  confirmed: z.literal(true, { error: 'Bitte bestätige deine Angaben.' }),
});

export const portfolioItemSchema = z.object({
  title: z.string({ error: 'Bitte gib einen Titel ein.' }).trim().min(3, 'Mindestens 3 Zeichen.').max(120, 'Höchstens 120 Zeichen.'),
  description: optionalText(1000),
  categorySlug: z
    .string()
    .refine((slug) => Boolean(serviceCategoryBySlug(slug)), 'Unbekannte Kategorie.')
    .nullable()
    .optional(),
  url: optionalUrl,
});
export type PortfolioItemInput = z.input<typeof portfolioItemSchema>;

export const portfolioImageRightsSchema = z.object({
  rights: z.enum(PORTFOLIO_IMAGE_RIGHTS, { error: 'Bitte gib an, woher das Bild stammt.' }),
  credit: z.string().trim().max(120).optional().transform((v) => v || undefined),
});

export const qualificationSchema = z.object({
  title: z.string({ error: 'Bitte gib die Qualifikation an.' }).trim().min(3, 'Mindestens 3 Zeichen.').max(120, 'Höchstens 120 Zeichen.'),
  issuer: optionalText(120),
  /** z. B. GISA-Zahl der Gewerbeberechtigung, Zeugnis- oder Registernummer */
  reference: optionalText(120),
});
export type QualificationInput = z.input<typeof qualificationSchema>;

export const qualificationReviewSchema = z.object({
  decision: z.enum(['VERIFY', 'REJECT']),
  note: z.string().trim().max(500).optional(),
});
export type QualificationReviewInput = z.infer<typeof qualificationReviewSchema>;
