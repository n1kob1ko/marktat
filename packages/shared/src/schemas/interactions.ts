import { z } from 'zod';

/** Höchstlänge einer Nachricht (Zeichen). Gleicher Wert in der Datenbank (VARCHAR). */
export const MESSAGE_MAX_LENGTH = 2000;
/** Höchstzahl gespeicherter Suchen je Konto */
export const MAX_SAVED_SEARCHES = 50;
/** Höchstzahl gemerkter Inserate je Konto */
export const MAX_FAVORITES = 500;

// Steuerzeichen außer Zeilenumbruch und Tabulator, dazu unsichtbare Richtungszeichen (Spoofing)
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‎‏‪-‮⁦-⁩]/g;

/**
 * Nachrichtentext: Klartext, Zeilenumbrüche vereinheitlicht, Steuerzeichen entfernt,
 * höchstens eine Leerzeile am Stück. HTML wird nicht interpretiert, sondern als Text angezeigt.
 */
export function normalizeMessageBody(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const messageBodySchema = z
  .string({ error: 'Bitte schreib eine Nachricht.' })
  .transform(normalizeMessageBody)
  .pipe(
    z
      .string()
      .min(1, 'Bitte schreib eine Nachricht.')
      .max(MESSAGE_MAX_LENGTH, `Eine Nachricht darf höchstens ${MESSAGE_MAX_LENGTH.toLocaleString('de-AT')} Zeichen lang sein.`),
  );

export const sendMessageSchema = z.object({ body: messageBodySchema }).strict();
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const savedSearchNameSchema = z
  .string()
  .transform((v) => v.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, 'Bitte gib der Suche einen Namen.').max(80, 'Der Name darf höchstens 80 Zeichen lang sein.'));

/** Kurzbeschreibung der Filter (z. B. „Preis bis € 500“) – nur zur Anzeige für die eigene Person. */
const savedSearchLabelsSchema = z
  .array(z.string().transform((v) => v.replace(CONTROL_CHARS, '').trim().slice(0, 80)))
  .max(20)
  .transform((labels) => labels.filter(Boolean));

export const createSavedSearchSchema = z.object({
  name: savedSearchNameSchema,
  /** Parameter wie in der Such-URL; die API prüft sie mit derselben Logik wie die Suche. */
  params: z.record(z.string().max(40), z.string().max(500)).refine((p) => Object.keys(p).length <= 40, 'Zu viele Suchparameter.'),
  labels: savedSearchLabelsSchema.default([]),
  notify: z.boolean().default(false),
});
export type CreateSavedSearchInput = z.infer<typeof createSavedSearchSchema>;

export const updateSavedSearchSchema = z
  .object({ name: savedSearchNameSchema.optional(), notify: z.boolean().optional() })
  .refine((v) => v.name !== undefined || v.notify !== undefined, 'Nichts zu ändern.');
export type UpdateSavedSearchInput = z.infer<typeof updateSavedSearchSchema>;

export const notificationSettingsSchema = z
  .object({ notifyMessagesByEmail: z.boolean().optional(), notifySearchesByEmail: z.boolean().optional() })
  .strict();
export type NotificationSettingsInput = z.infer<typeof notificationSettingsSchema>;

export const REPORT_REASONS = ['SPAM', 'FRAUD', 'HARASSMENT', 'OTHER'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  SPAM: 'Spam oder Werbung',
  FRAUD: 'Betrugsverdacht',
  HARASSMENT: 'Belästigung oder Beleidigung',
  OTHER: 'Etwas anderes',
};

export const reportUserSchema = z.object({
  reason: z.enum(REPORT_REASONS, { error: 'Bitte wähle einen Grund.' }),
  details: z
    .string()
    .transform((v) => v.replace(CONTROL_CHARS, '').trim())
    .pipe(z.string().max(1000, 'Höchstens 1.000 Zeichen.'))
    .optional()
    .transform((v) => v || undefined),
});
export type ReportUserInput = z.infer<typeof reportUserSchema>;
