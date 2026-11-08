/**
 * Einfacher Spam-Filter für Nachrichten – ergänzt die Mengenlimits (MESSAGE_LIMITS) um Inhalte:
 * 1. Konten, die jünger als ein Tag sind, dürfen keine Links schicken (typisch für Phishing „Zahl über diesen Link“).
 * 2. Dieselbe Nachricht an viele Anbieter in kurzer Zeit wird gebremst (Massenanschreiben).
 * Reine Funktionen ohne Datenbank; die Entscheidung trifft MessagesService.
 */

/** Konten unter diesem Alter gelten als neu */
export const NEW_ACCOUNT_HOURS = 24;
/** Ab so vielen gleichen Nachrichten an verschiedene Unterhaltungen innerhalb einer Stunde wird gebremst */
export const DUPLICATE_LIMIT = 3;
/** Kürzere Nachrichten („Hallo, noch zu haben?“) werden nicht als Massenanschreiben gewertet */
export const DUPLICATE_MIN_LENGTH = 25;

const URL_PATTERN = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:at|de|ch|com|net|org|eu|io|info|shop|xyz|online|site|link|me|co|biz|to|ly|gg|app|top|club|store)(?:\/\S*|\b)/i;

/** Enthält die Nachricht einen Link oder eine Domain? Abkürzungen wie „z.B.“ oder „8010 Graz.“ zählen nicht. */
export function containsLink(body: string): boolean {
  return URL_PATTERN.test(body);
}

export function isNewAccount(createdAt: Date, now = new Date()): boolean {
  return now.getTime() - createdAt.getTime() < NEW_ACCOUNT_HOURS * 3600_000;
}

/** Vergleichsform: Kleinschreibung, Satzzeichen und Mehrfach-Leerzeichen weg – „Hallo!!“ und „hallo“ sind gleich */
export function normalizeForComparison(body: string): string {
  return body
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Massenanschreiben: dieselbe (normalisierte) Nachricht ging in der letzten Stunde schon an DUPLICATE_LIMIT
 * andere Unterhaltungen. `recent` sind die eigenen Nachrichten der letzten Stunde.
 */
export function isMassMessage(body: string, recent: { body: string; conversationId: string }[], excludeConversationId?: string): boolean {
  const normalized = normalizeForComparison(body);
  if (normalized.length < DUPLICATE_MIN_LENGTH) return false;
  const conversations = new Set(
    recent.filter((m) => m.conversationId !== excludeConversationId && normalizeForComparison(m.body) === normalized).map((m) => m.conversationId),
  );
  return conversations.size >= DUPLICATE_LIMIT;
}

export const LINK_BLOCKED_MESSAGE = `In den ersten ${NEW_ACCOUNT_HOURS} Stunden nach der Registrierung sind Links in Nachrichten nicht möglich. Beschreib dein Anliegen bitte ohne Link – danach kannst du ihn nachreichen.`;
export const MASS_MESSAGE_BLOCKED = 'Diese Nachricht hast du gerade schon mehreren Anbietern geschickt. Bitte formuliere deine Anfrage individuell – so bekommst du auch eher eine Antwort.';
