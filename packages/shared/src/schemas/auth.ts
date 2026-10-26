import { z } from 'zod';
import { ACCOUNT_TYPES } from '../enums.js';

/**
 * Passwortrichtlinie: mindestens 10 Zeichen, höchstens 72 (Grenze von bcrypt in Supabase Auth),
 * mindestens ein Buchstabe und eine Ziffer. Länge ist wirksamer als Sonderzeichenregeln (NIST SP 800-63B).
 */
export const passwordSchema = z
  .string()
  .min(10, 'Das Passwort muss mindestens 10 Zeichen lang sein.')
  .max(72, 'Das Passwort darf höchstens 72 Zeichen lang sein.')
  .regex(/[A-Za-zÄÖÜäöüß]/, 'Das Passwort muss mindestens einen Buchstaben enthalten.')
  .regex(/\d/, 'Das Passwort muss mindestens eine Ziffer enthalten.');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Bitte gib eine gültige E-Mail-Adresse ein.').max(254));

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, 'Der Anzeigename muss mindestens 2 Zeichen lang sein.')
  .max(50, 'Der Anzeigename darf höchstens 50 Zeichen lang sein.')
  .regex(/^[^<>]*$/, 'Der Anzeigename enthält ungültige Zeichen.');

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    displayName: displayNameSchema,
    accountType: z.enum(ACCOUNT_TYPES),
    companyName: z.string().trim().max(120).optional(),
    acceptTerms: z.literal(true, {
      error: 'Bitte akzeptiere die Nutzungsbedingungen und die Datenschutzerklärung.',
    }),
  })
  .superRefine((value, ctx) => {
    if (value.accountType === 'BUSINESS' && (!value.companyName || value.companyName.length < 2)) {
      ctx.addIssue({
        code: 'custom',
        path: ['companyName'],
        message: 'Für gewerbliche Konten ist der Firmenname verpflichtend.',
      });
    }
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Bitte gib dein Passwort ein.').max(72),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    passwordConfirm: z.string(),
  })
  .refine((v) => v.password === v.passwordConfirm, {
    path: ['passwordConfirm'],
    message: 'Die Passwörter stimmen nicht überein.',
  });
