import { z } from './zod.js';
import { CONTROL_CHARS } from './interactions.js';
import { portfolioItemDecisionSchema } from './moderation.js';
import type { AccountType } from '../enums.js';
import type { ConversationSubjectKind } from '../types.js';

// ---------------------------------------------------------------------------
// Bewertungen nach einem Kontakt
// ---------------------------------------------------------------------------

export const RATING_COMMENT_MAX = 500;
export const RATING_REPLY_MAX = 500;
export const RATING_STAR_LABELS: Record<number, string> = {
  1: 'Sehr schlecht',
  2: 'Schlecht',
  3: 'Okay',
  4: 'Gut',
  5: 'Sehr gut',
};

const cleanOptional = (max: number) =>
  z
    .string()
    .transform((v) => v.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').trim())
    .pipe(z.string().max(max, `Höchstens ${max} Zeichen.`))
    .optional()
    .transform((v) => v || undefined);

export const rateSchema = z
  .object({
    stars: z.coerce
      .number({ error: 'Bitte wähle 1 bis 5 Sterne.' })
      .int('Bitte wähle 1 bis 5 Sterne.')
      .min(1, 'Bitte wähle 1 bis 5 Sterne.')
      .max(5, 'Bitte wähle 1 bis 5 Sterne.'),
    comment: cleanOptional(RATING_COMMENT_MAX),
  })
  .strict();
export type RateInput = z.infer<typeof rateSchema>;

export const ratingReplySchema = z
  .object({
    body: z
      .string({ error: 'Bitte schreibe eine Antwort.' })
      .transform((v) => v.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').trim())
      .pipe(
        z
          .string()
          .min(2, 'Bitte schreibe eine Antwort.')
          .max(RATING_REPLY_MAX, `Höchstens ${RATING_REPLY_MAX} Zeichen.`),
      ),
  })
  .strict();
export type RatingReplyInput = z.infer<typeof ratingReplySchema>;

/** Bewertung ausblenden bzw. wieder zeigen (Moderation) – gleiche Felder wie bei Portfolio-Einträgen */
export const ratingDecisionSchema = portfolioItemDecisionSchema;
export type RatingDecisionInput = z.infer<typeof ratingDecisionSchema>;

// ---------------------------------------------------------------------------
// Antworten der API
// ---------------------------------------------------------------------------

export interface RatingSummary {
  /** Durchschnitt auf eine Nachkommastelle; null ohne Bewertungen */
  average: number | null;
  count: number;
  /** Anzahl je Sternezahl, Index 0 = 1 Stern … Index 4 = 5 Sterne */
  distribution: [number, number, number, number, number];
}

export interface RatingItem {
  id: string;
  stars: number;
  comment: string | null;
  reply: string | null;
  repliedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Rolle der bewertenden Person in der Unterhaltung: buyer = hat angefragt, seller = hat angeboten */
  raterRole: 'buyer' | 'seller';
  rater: { id: string; displayName: string };
  ratee: { id: string; displayName: string };
  /** Worum es ging (Titel des Inserats, Profils oder Auftrags); null, wenn es gelöscht ist */
  subject: { kind: ConversationSubjectKind; title: string } | null;
  /** Nur in eigenen Listen: von der Moderation ausgeblendet */
  hidden?: boolean;
  /** Nur in eigenen Listen: Unterhaltung, in der bewertet wurde (zum Ändern) */
  conversationId?: string;
}

export interface PublicRatings {
  user: { id: string; displayName: string; accountType: AccountType; memberSince: string };
  summary: RatingSummary;
  items: RatingItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface MyRatings {
  summary: RatingSummary;
  received: RatingItem[];
  given: RatingItem[];
}

export interface ConversationRating {
  conversationId: string;
  partner: { id: string; displayName: string };
  subject: { kind: ConversationSubjectKind; title: string; href: string };
  /** null = Bewerten möglich, sonst der Grund */
  blockedReason: string | null;
  mine: RatingItem | null;
  theirs: RatingItem | null;
}
