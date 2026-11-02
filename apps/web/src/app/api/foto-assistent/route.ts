import { AUTOFILL_IMAGE_TYPES, AUTOFILL_MAX_BYTES, AUTOFILL_MAX_PHOTOS, type AutofillRequest } from '@marktat/shared';
import { getAccessToken } from '@/lib/auth';
import { serverEnv } from '@/lib/env';
import { sameOrigin } from '@/lib/same-origin';

const TYPES = new Set<string>(AUTOFILL_IMAGE_TYPES);
/** Ganze Anfrage: alle Fotos plus etwas Platz für die Formular-Trennzeilen */
const MAX_REQUEST_BYTES = AUTOFILL_MAX_BYTES * AUTOFILL_MAX_PHOTOS + 64 * 1024;

function json(status: number, body: unknown) {
  return Response.json(body, { status });
}

/**
 * Foto-Assistent: Fotos (Formularfeld „foto“, ein bis vier) an die API weiterreichen und die Vorschläge zurückgeben.
 * Eigene Route statt Server Action (deren Größenlimit 1 MB ist); das Access-Token bleibt auf dem Server.
 * Gespeichert wird hier nichts.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json(403, { message: 'Nicht erlaubt.' });
  const token = await getAccessToken();
  if (!token) return json(401, { message: 'Bitte melde dich an.' });
  if (Number(request.headers.get('content-length') ?? '0') > MAX_REQUEST_BYTES) return json(413, { message: 'Die Fotos sind zu groß.' });

  const form = await request.formData().catch(() => null);
  const files = (form?.getAll('foto') ?? []).filter((entry): entry is File => typeof entry !== 'string');
  if (!files.length) return json(400, { message: 'Bitte füge zuerst ein Foto hinzu.' });
  if (files.length > AUTOFILL_MAX_PHOTOS) return json(400, { message: `Bitte höchstens ${AUTOFILL_MAX_PHOTOS} Fotos auf einmal.` });
  if (files.some((file) => !TYPES.has(file.type))) return json(400, { message: 'Bitte verwende Fotos als JPEG, PNG oder WebP.' });
  if (files.some((file) => file.size === 0 || file.size > AUTOFILL_MAX_BYTES)) return json(400, { message: 'Ein Foto ist leer oder zu groß.' });
  const body: AutofillRequest = { images: await Promise.all(files.map(async (file) => Buffer.from(await file.arrayBuffer()).toString('base64'))) };

  try {
    const response = await fetch(`${serverEnv.apiUrl}/v1/autofill/listing`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      // Die Auswertung dauert meist wenige Sekunden; länger als eine Minute wartet niemand
      signal: AbortSignal.timeout(70_000),
    });
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      return json(response.status, { message: typeof data?.message === 'string' ? data.message : 'Die Fotos konnten nicht ausgewertet werden.' });
    }
    return json(200, data);
  } catch {
    return json(503, { message: 'Der Server ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.' });
  }
}
