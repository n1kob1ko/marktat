import { DEAL_IMPORT_MAX_BYTES } from '@marktat/shared';
import { getAccessToken } from '@/lib/auth';
import { serverEnv } from '@/lib/env';
import { sameOrigin } from '@/lib/same-origin';

function json(status: number, body: unknown) {
  return Response.json(body, { status });
}

/**
 * CSV-Datei für den Deal-Import hochladen (Route statt Server Action, damit die Datei als Rohdaten an die API geht).
 * Zeichensatz, Spalten und jede Zeile prüft die API; hier wird nur Herkunft, Anmeldung und Größe geprüft.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json(403, { message: 'Nicht erlaubt.' });
  const token = await getAccessToken();
  if (!token) return json(401, { message: 'Bitte melde dich an.' });
  const size = Number(request.headers.get('content-length') ?? '0');
  if (size > DEAL_IMPORT_MAX_BYTES) return json(413, { message: 'Die Datei darf höchstens 2 MB groß sein.' });
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return json(400, { message: 'Bitte wähle eine CSV-Datei aus.' });
  if (body.byteLength > DEAL_IMPORT_MAX_BYTES) return json(413, { message: 'Die Datei darf höchstens 2 MB groß sein.' });
  const name = (new URL(request.url).searchParams.get('datei') ?? '').slice(0, 200);
  try {
    const response = await fetch(`${serverEnv.apiUrl}/v1/me/deal-imports?${new URLSearchParams({ datei: name })}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/csv' },
      body,
      cache: 'no-store',
    });
    const data = (await response.json().catch(() => null)) as { message?: string; id?: string } | null;
    if (!response.ok || !data?.id) return json(response.ok ? 502 : response.status, { message: data?.message ?? 'Die Datei konnte nicht gelesen werden.' });
    return json(201, { id: data.id });
  } catch {
    return json(503, { message: 'Der Server ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.' });
  }
}
