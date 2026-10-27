import { getAccessToken } from '@/lib/auth';
import { serverEnv } from '@/lib/env';
import { sameOrigin } from '@/lib/same-origin';

const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 15 * 1024 * 1024;
const ENTITY_ID = /^[a-z0-9]{20,40}$/;
const RIGHTS = new Set(['OWN', 'MANUFACTURER', 'LICENSED']);


function json(status: number, body: unknown) {
  return Response.json(body, { status });
}

/**
 * Produktbild eines Deals hochladen bzw. entfernen (wie beim Firmenlogo über eine Route statt einer Server Action).
 * Die Angabe zu den Bildrechten ist Pflicht; Prüfen, Verkleinern und Entfernen der Metadaten übernimmt die API.
 */
export async function PUT(request: Request, { params }: RouteContext<'/api/medien/deals/[id]'>) {
  const { id } = await params;
  if (!sameOrigin(request)) return json(403, { message: 'Nicht erlaubt.' });
  if (!ENTITY_ID.test(id)) return json(404, { message: 'Dieses Angebot gibt es nicht.' });
  const token = await getAccessToken();
  if (!token) return json(401, { message: 'Bitte melde dich an.' });
  const url = new URL(request.url);
  const rights = url.searchParams.get('rechte') ?? '';
  const credit = (url.searchParams.get('quelle') ?? '').slice(0, 120);
  if (!RIGHTS.has(rights)) return json(400, { message: 'Bitte gib an, woher das Bild stammt.' });
  const type = request.headers.get('content-type') ?? '';
  const size = Number(request.headers.get('content-length') ?? '0');
  if (!TYPES.has(type)) return json(400, { message: 'Bitte lade ein JPEG-, PNG- oder WebP-Bild hoch.' });
  if (size > MAX_BYTES) return json(413, { message: 'Das Bild darf höchstens 15 MB groß sein.' });
  const body = await request.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return json(400, { message: 'Das Bild darf höchstens 15 MB groß sein.' });
  const query = new URLSearchParams({ rechte: rights, ...(credit ? { quelle: credit } : {}) });
  return forward('PUT', `${serverEnv.apiUrl}/v1/media/deals/${id}?${query}`, token, body, type);
}

export async function DELETE(request: Request, { params }: RouteContext<'/api/medien/deals/[id]'>) {
  const { id } = await params;
  if (!sameOrigin(request)) return json(403, { message: 'Nicht erlaubt.' });
  if (!ENTITY_ID.test(id)) return json(404, { message: 'Dieses Angebot gibt es nicht.' });
  const token = await getAccessToken();
  if (!token) return json(401, { message: 'Bitte melde dich an.' });
  return forward('DELETE', `${serverEnv.apiUrl}/v1/me/deals/${id}/image`, token);
}

async function forward(method: 'PUT' | 'DELETE', url: string, token: string, body?: ArrayBuffer, type?: string) {
  try {
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(type ? { 'Content-Type': type } : {}) },
      body,
      cache: 'no-store',
    });
    const data = (await response.json().catch(() => null)) as { message?: string; imageUrl?: string | null } | null;
    if (!response.ok) return json(response.status, { message: data?.message ?? 'Das Bild konnte nicht gespeichert werden.' });
    return json(200, { imageUrl: data?.imageUrl ?? null });
  } catch {
    return json(503, { message: 'Der Server ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.' });
  }
}
