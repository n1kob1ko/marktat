import { getAccessToken } from '@/lib/auth';
import { serverEnv } from '@/lib/env';

const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024;

/** Nur Anfragen dieser Website (Schutz vor fremden Formularen, die das Sitzungs-Cookie mitschicken) */
function sameOrigin(request: Request) {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = request.headers.get('origin');
  return origin !== null && origin === new URL(request.url).origin;
}

function json(status: number, body: unknown) {
  return Response.json(body, { status });
}

/**
 * Firmenlogo hochladen bzw. entfernen. Läuft über diese Route statt einer Server Action (deren Größenlimit 1 MB ist);
 * das Access-Token bleibt auf dem Server. Prüfen und Verkleinern übernimmt die API.
 */
export async function PUT(request: Request) {
  if (!sameOrigin(request)) return json(403, { message: 'Nicht erlaubt.' });
  const token = await getAccessToken();
  if (!token) return json(401, { message: 'Bitte melde dich an.' });
  const type = request.headers.get('content-type') ?? '';
  const size = Number(request.headers.get('content-length') ?? '0');
  if (!TYPES.has(type)) return json(400, { message: 'Bitte lade ein JPEG-, PNG- oder WebP-Bild hoch.' });
  if (size > MAX_BYTES) return json(413, { message: 'Das Logo darf höchstens 5 MB groß sein.' });
  const body = await request.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return json(400, { message: 'Das Logo darf höchstens 5 MB groß sein.' });
  return forward('PUT', token, body, type);
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json(403, { message: 'Nicht erlaubt.' });
  const token = await getAccessToken();
  if (!token) return json(401, { message: 'Bitte melde dich an.' });
  return forward('DELETE', token);
}

async function forward(method: 'PUT' | 'DELETE', token: string, body?: ArrayBuffer, type?: string) {
  try {
    const response = await fetch(`${serverEnv.apiUrl}/v1/me/logo`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(type ? { 'Content-Type': type } : {}) },
      body,
      cache: 'no-store',
    });
    const data = (await response.json().catch(() => null)) as { message?: string; logoUrl?: string | null } | null;
    if (!response.ok) return json(response.status, { message: data?.message ?? 'Das Logo konnte nicht gespeichert werden.' });
    return json(200, { logoUrl: data?.logoUrl ?? null });
  } catch {
    return json(503, { message: 'Der Server ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.' });
  }
}
