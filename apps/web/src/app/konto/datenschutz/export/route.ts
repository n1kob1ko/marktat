import { NextResponse } from 'next/server';
import { getAccessToken } from '@/lib/auth';
import { serverEnv } from '@/lib/env';

/**
 * Datenexport als Datei-Download. Der Browser bekommt nur die JSON-Datei, das Access-Token bleibt auf dem Server.
 * Gesperrte Konten dürfen ihre Daten ebenfalls exportieren (die API erlaubt das ausdrücklich).
 */
export async function GET() {
  const token = await getAccessToken();
  if (!token) return NextResponse.redirect(new URL('/anmelden?weiter=%2Fkonto%2Fdatenschutz', serverEnv.webUrl), 303);

  const res = await fetch(`${serverEnv.apiUrl}/v1/me/export`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' }).catch(() => null);
  if (!res || !res.ok) {
    const reason = res?.status === 429 ? 'export-limit' : 'export';
    return NextResponse.redirect(new URL(`/konto/datenschutz?fehler=${reason}`, serverEnv.webUrl), 303);
  }
  return new NextResponse(res.body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': res.headers.get('content-disposition') ?? 'attachment; filename="marktat-export.json"',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
