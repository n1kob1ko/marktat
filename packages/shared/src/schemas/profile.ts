import { z } from 'zod';
import { displayNameSchema } from './auth.js';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

/** Profildaten, die der Benutzer selbst ändern darf. Rollen und Kontotyp sind bewusst ausgenommen. */
export const updateProfileSchema = z.object({
  displayName: displayNameSchema.optional(),
  bio: optionalText(500),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()/-]{6,20}$/, 'Bitte gib eine gültige Telefonnummer ein.')
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  companyName: optionalText(120),
  /** Firmenbuchnummer, z. B. „FN 123456a“ */
  companyRegisterNumber: optionalText(30),
  /** UID-Nummer, z. B. „ATU12345678“ */
  vatId: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^ATU\d{8}$/, 'Die UID-Nummer muss das Format ATU12345678 haben.')
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  companyAddress: optionalText(200),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
