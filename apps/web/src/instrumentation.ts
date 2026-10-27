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
};
