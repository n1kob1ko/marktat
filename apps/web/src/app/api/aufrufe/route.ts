import { createHash } from 'node:crypto';
import { getAccessToken } from '@/lib/auth';
import { serverEnv } from '@/lib/env';

const ID_PATTERN = /^[a-z0-9]{20,40}$/;
/** Bekannte Bots, Vorschau-Dienste und Automatisierung zählen nicht als Aufruf */
const BOT_PATTERN =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|httpclient|go-http|axios|node-fetch|playwright|puppeteer|selenium/i;

/**
 * Aufruf einer Anzeige melden. Der Browser schickt nur die Inserats-ID; hier wird ein Pseudonym aus IP und Browser
 * gebildet (nie gespeichert, die API verknüpft es tageweise per HMAC) und mit dem Sitzungs-Token weitergereicht,
 * damit eigene und Team-Aufrufe nicht zählen. Wiederholte Aufrufe und Neuladen filtert die API.
 */
export async function POST(request: Request) {
  const userAgent = request.headers.get('user-agent') ?? '';
  // Nur echte Seitenaufrufe von hier (gleiche Herkunft), keine Bots
  if (!userAgent || BOT_PATTERN.test(userAgent) || request.headers.get('sec-fetch-site') !== 'same-origin') {
    return new Response(null, { status: 204 });
  }
  const body = (await request.json().catch(() => null)) as { listingId?: unknown } | null;
  const listingId = typeof body?.listingId === 'string' ? body.listingId : '';
  if (!ID_PATTERN.test(listingId)) return new Response(null, { status: 400 });

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unbekannt';
  const visitor = createHash('sha256').update(`${ip}|${userAgent}`).digest('hex');
  const token = await getAccessToken();
  try {
    await fetch(`${serverEnv.apiUrl}/v1/listings/${listingId}/views`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Für das Rate-Limit der API je Person (wirksam, wenn die API dem Web-Server als Proxy vertraut: TRUST_PROXY)
        'X-Forwarded-For': ip,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ visitor }),
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Statistik ist nicht kritisch – Fehler nie an den Browser weitergeben
  }
  return new Response(null, { status: 204 });
}
