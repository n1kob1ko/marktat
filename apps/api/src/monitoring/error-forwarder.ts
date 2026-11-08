import { randomUUID } from 'node:crypto';

/**
 * Weiterleitung von Fehlern an einen Sentry-kompatiblen Dienst (Sentry, GlitchTip) ohne SDK: ein kleiner
 * „Envelope“ per HTTP. Nur aktiv mit SENTRY_DSN. Gemeldet wird, was auch in der Fehlerübersicht steht –
 * bereinigte Meldung, Fehlertyp, Route und gekürzter Stack – keine Request-Daten, Cookies oder Personen.
 */
export interface ForwardedError {
  errorName: string;
  /** Bereits bereinigt (normalizeMessage) */
  message: string;
  stack: string | null;
  source: string;
  route: string;
  environment: string;
  release?: string | null;
}

export interface ParsedDsn {
  endpoint: string;
  publicKey: string;
}

/** DSN `https://<key>@<host>/<projekt>` → Envelope-Endpunkt und öffentlicher Schlüssel; ungültig → null */
export function parseDsn(dsn: string | undefined): ParsedDsn | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/\/+$/, '').split('/').pop();
    if (url.protocol !== 'https:' || !url.username || !projectId || !/^\d+$/.test(projectId)) return null;
    const base = url.pathname.slice(0, url.pathname.lastIndexOf(`/${projectId}`));
    return { endpoint: `${url.origin}${base}/api/${projectId}/envelope/`, publicKey: url.username };
  } catch {
    return null;
  }
}

const FRAME = /^at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;

/** Stack-Zeilen („at fn (datei:zeile:spalte)“) in Sentry-Frames; Sentry erwartet den ältesten Aufruf zuerst */
export function stackFrames(stack: string | null): { function: string; filename: string; lineno: number; colno: number }[] {
  if (!stack) return [];
  return stack
    .split('\n')
    .map((line) => FRAME.exec(line.trim()))
    .flatMap((match) => (match ? [{ function: match[1] ?? '<anonym>', filename: match[2]!, lineno: Number(match[3]), colno: Number(match[4]) }] : []))
    .reverse();
}

export function buildEnvelope(error: ForwardedError, now = new Date()): string {
  const eventId = randomUUID().replace(/-/g, '');
  const frames = stackFrames(error.stack);
  const event = {
    event_id: eventId,
    timestamp: now.toISOString(),
    platform: 'node',
    level: 'error',
    logger: error.source,
    transaction: error.route,
    environment: error.environment,
    ...(error.release ? { release: error.release } : {}),
    tags: { source: error.source, route: error.route },
    exception: {
      values: [{ type: error.errorName, value: error.message, ...(frames.length ? { stacktrace: { frames } } : {}) }],
    },
  };
  const header = { event_id: eventId, sent_at: now.toISOString(), sdk: { name: 'markterl.envelope', version: '1.0.0' } };
  return `${JSON.stringify(header)}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`;
}

/** Schickt den Fehler weiter; Fehler beim Senden werden verschluckt (der Dienst darf die API nie beeinträchtigen). */
export async function forwardError(dsn: ParsedDsn, error: ForwardedError, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    await fetchImpl(dsn.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=markterl.envelope/1.0.0, sentry_key=${dsn.publicKey}`,
      },
      body: buildEnvelope(error),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // bewusst still
  }
}
