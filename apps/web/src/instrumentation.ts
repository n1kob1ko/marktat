import type { Instrumentation } from 'next';

/**
 * Serverfehler der Web-App als eine JSON-Zeile ins Log (für Log-Sammler und eine spätere Anbindung an einen
 * Monitoring-Dienst, siehe docs/betrieb.md). Bewusst ohne Query-String, Cookies, Header und Formulardaten;
 * statt des konkreten Pfads das Routenmuster (z. B. /anzeige/[id]).
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const err = error as Error & { digest?: string };
  const line = {
    time: new Date().toISOString(),
    level: 'error',
    msg: 'web_request_error',
    method: request.method,
    route: context.routePath,
    routeType: context.routeType,
    digest: err.digest ?? null,
    error: err.name,
    message: String(err.message ?? '')
      .replace(/[^\s<>@"']+@[^\s<>@"']+/g, '[E-Mail]')
      .slice(0, 300),
  };
  console.error(JSON.stringify(line));
  void forwardToErrorService(line);
};

/**
 * Mit SENTRY_DSN (nur Serverumgebung) geht dieselbe bereinigte Meldung als Envelope an Sentry bzw. GlitchTip –
 * ohne SDK, wie in der API (apps/api/src/monitoring/error-forwarder.ts). Sendefehler bleiben still.
 */
async function forwardToErrorService(line: { route: string | undefined; error: string; message: string; digest: string | null }) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/\/+$/, '').split('/').pop();
    if (url.protocol !== 'https:' || !url.username || !projectId || !/^\d+$/.test(projectId)) return;
    const base = url.pathname.slice(0, url.pathname.lastIndexOf(`/${projectId}`));
    const eventId = crypto.randomUUID().replace(/-/g, '');
    const now = new Date().toISOString();
    const event = {
      event_id: eventId,
      timestamp: now,
      platform: 'javascript',
      level: 'error',
      logger: 'web',
      transaction: line.route ?? 'unbekannt',
      environment: process.env.NODE_ENV ?? 'production',
      tags: { source: 'web', route: line.route ?? 'unbekannt', ...(line.digest ? { digest: line.digest } : {}) },
      exception: { values: [{ type: line.error, value: line.message }] },
    };
    const body = `${JSON.stringify({ event_id: eventId, sent_at: now, sdk: { name: 'markterl.envelope', version: '1.0.0' } })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`;
    await fetch(`${url.origin}${base}/api/${projectId}/envelope/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=markterl.envelope/1.0.0, sentry_key=${url.username}`,
      },
      body,
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // bewusst still
  }
}
