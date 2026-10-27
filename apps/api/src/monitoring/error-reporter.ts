import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { redact } from '../common/redact.js';

export interface ErrorContext {
  source: 'http' | 'job' | 'web';
  /** Routenmuster (ohne konkrete IDs und ohne Query-String) bzw. Auftragsname */
  route: string;
  requestId?: string;
}

/** Zahlen, UUIDs, cuids, Hex-Werte und E-Mails aus Meldungen entfernen – gleiche Ursache, gleiche Zeile */
export function normalizeMessage(message: string): string {
  return redact(message)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':uuid')
    .replace(/\bc[a-z0-9]{20,30}\b/g, ':id')
    .replace(/\b[0-9a-f]{16,}\b/gi, ':hex')
    .replace(/\d+/g, '0')
    .slice(0, 300);
}

/** Nur die ersten Stack-Zeilen ohne die Meldung selbst (die steht schon in `message`) */
function shortStack(error: unknown): string | null {
  if (!(error instanceof Error) || !error.stack) return null;
  return error.stack
    .split('\n')
    .filter((line) => line.trimStart().startsWith('at '))
    .slice(0, 8)
    .map((line) => line.trim())
    .join('\n');
}

/**
 * Sammelt unerwartete Fehler datensparsam in `error_events` (Fehlerübersicht im Admin-Bereich) und schreibt
 * eine strukturierte Logzeile. Ein externer Dienst (z. B. Sentry) lässt sich hier anschließen – siehe
 * docs/betrieb.md; ohne Freigabe ist keiner aktiv.
 */
@Injectable()
export class ErrorReporter {
  private readonly logger = new Logger('Fehler');

  constructor(private readonly prisma: PrismaService) {}

  capture(error: unknown, context: ErrorContext): void {
    const errorName = error instanceof Error ? error.name : typeof error;
    const raw = error instanceof Error ? error.message : String(error);
    const message = normalizeMessage(raw);
    const stack = shortStack(error);
    const fingerprint = createHash('sha256').update([context.source, context.route, errorName, message].join('|')).digest('hex');
    this.logger.error(
      `${context.source} ${context.route}: ${errorName}: ${message}${context.requestId ? ` (Anfrage ${context.requestId})` : ''}`,
      stack ?? undefined,
    );
    // Asynchron: Ein Fehler beim Speichern (z. B. Datenbank weg) darf die Antwort nicht verzögern
    this.prisma.errorEvent
      .upsert({
        where: { fingerprint },
        create: { fingerprint, source: context.source, route: context.route.slice(0, 200), errorName: errorName.slice(0, 100), message, stack },
        update: { count: { increment: 1 }, lastSeenAt: new Date(), stack },
      })
      .catch(() => undefined);
  }
}
