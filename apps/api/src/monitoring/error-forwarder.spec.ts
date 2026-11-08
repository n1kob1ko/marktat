import { describe, expect, it, vi } from 'vitest';
import { buildEnvelope, forwardError, parseDsn, stackFrames } from './error-forwarder.js';

describe('Weiterleitung an Sentry/GlitchTip', () => {
  it('liest den DSN und bildet den Envelope-Endpunkt', () => {
    expect(parseDsn('https://abc123@o4507.ingest.de.sentry.io/4508')).toEqual({ endpoint: 'https://o4507.ingest.de.sentry.io/api/4508/envelope/', publicKey: 'abc123' });
    expect(parseDsn('https://key@glitchtip.example.at/3')).toEqual({ endpoint: 'https://glitchtip.example.at/api/3/envelope/', publicKey: 'key' });
    expect(parseDsn('http://key@unsicher.example/3')).toBeNull();
    expect(parseDsn('https://glitchtip.example.at/3')).toBeNull();
    expect(parseDsn('kein dsn')).toBeNull();
    expect(parseDsn(undefined)).toBeNull();
  });

  it('wandelt den Stack in Frames (ältester Aufruf zuerst) und baut einen gültigen Envelope', () => {
    const stack = 'at ListingsService.findMine (/app/dist/listings/listings.service.js:120:15)\nat /app/dist/main.js:10:3';
    expect(stackFrames(stack)).toEqual([
      { function: '<anonym>', filename: '/app/dist/main.js', lineno: 10, colno: 3 },
      { function: 'ListingsService.findMine', filename: '/app/dist/listings/listings.service.js', lineno: 120, colno: 15 },
    ]);
    const envelope = buildEnvelope(
      { errorName: 'Error', message: 'Verbindung zu [E-Mail] abgebrochen', stack, source: 'http', route: 'GET /v1/listings/mine', environment: 'production', release: '1.2.3' },
      new Date('2026-11-08T10:00:00Z'),
    );
    const [header, item, event] = envelope.trimEnd().split('\n').map((line) => JSON.parse(line));
    expect(header.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(item).toEqual({ type: 'event' });
    expect(event).toMatchObject({
      event_id: header.event_id,
      level: 'error',
      environment: 'production',
      release: '1.2.3',
      transaction: 'GET /v1/listings/mine',
      exception: { values: [{ type: 'Error', value: 'Verbindung zu [E-Mail] abgebrochen' }] },
    });
    expect(event.exception.values[0].stacktrace.frames).toHaveLength(2);
  });

  it('sendet mit Auth-Header und verschluckt Sendefehler', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response('', { status: 200 });
    }) as unknown as typeof fetch;
    const dsn = parseDsn('https://key@glitchtip.example.at/3')!;
    const error = { errorName: 'TypeError', message: 'x', stack: null, source: 'job', route: 'deal-feed-sync', environment: 'test' };
    await forwardError(dsn, error, fetchImpl);
    expect(calls[0]!.url).toBe('https://glitchtip.example.at/api/3/envelope/');
    expect((calls[0]!.init.headers as Record<string, string>)['X-Sentry-Auth']).toContain('sentry_key=key');
    await expect(forwardError(dsn, error, vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch)).resolves.toBeUndefined();
  });
});
