import { getAccessToken } from '@/lib/auth';
import { serverEnv } from '@/lib/env';

/**
 * Server-Sent Events für Nachrichten und Ungelesen-Zähler. Der Browser verbindet sich hierher (gleiche Herkunft,
 * Sitzungs-Cookie); diese Route reicht den Strom der API mit dem Access-Token durch, das so nie im Browser landet.
 */
export async function GET(request: Request) {
  const token = await getAccessToken();
  if (!token) return new Response('Nicht angemeldet', { status: 401 });

  let upstream: Response;
  try {
    upstream = await fetch(`${serverEnv.apiUrl}/v1/me/events`, {
      headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
      signal: request.signal,
      cache: 'no-store',
    });
  } catch {
    return new Response('Echtzeit-Verbindung nicht verfügbar', { status: 503 });
  }
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel();
    return new Response(null, { status: upstream.status === 401 ? 401 : 503 });
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform: keine Komprimierung, die Ereignisse sonst zurückhalten würde
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
