import { AUTOFILL_IMAGE_TYPES, AUTOFILL_MAX_BYTES } from '@marktat/shared';
import { getAccessToken } from '@/lib/auth';
import { serverEnv } from '@/lib/env';
import { sameOrigin } from '@/lib/same-origin';

const TYPES = new Set<string>(AUTOFILL_IMAGE_TYPES);

function json(status: number, body: unknown) {
  return Response.json(body, { status });
}

/**
 * Foto-Assistent: Foto an die API weiterreichen und die Vorschläge zurückgeben. Eigene Route statt Server Action
 * (deren Größenlimit 1 MB ist); das Access-Token bleibt auf dem Server. Gespeichert wird hier nichts.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json(403, { message: 'Nicht erlaubt.' });
  const token = await getAccessToken();
  if (!token) return json(401, { message: 'Bitte melde dich an.' });
  const type = request.headers.get('content-type') ?? '';
  if (!TYPES.has(type)) return json(400, { message: 'Bitte verwende ein Foto als JPEG, PNG oder WebP.' });
  if (Number(request.headers.get('content-length') ?? '0') > AUTOFILL_MAX_BYTES) return json(413, { message: 'Das Foto ist zu groß.' });
  const body = await request.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > AUTOFILL_MAX_BYTES) return json(400, { message: 'Das Foto ist leer oder zu groß.' });

  try {
    const response = await fetch(`${serverEnv.apiUrl}/v1/autofill/listing`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': type, Accept: 'application/json' },
      body,
      cache: 'no-store',
      // Die Auswertung dauert meist wenige Sekunden; länger als eine Minute wartet niemand
      signal: AbortSignal.timeout(70_000),
    });
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      return json(response.status, { message: typeof data?.message === 'string' ? data.message : 'Das Foto konnte nicht ausgewertet werden.' });
    }
    return json(200, data);
  } catch {
    return json(503, { message: 'Der Server ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.' });
  }
}
