import { serverEnv } from '@/lib/env';

/** Nur Anfragen dieser Website (Schutz vor fremden Formularen, die das Sitzungs-Cookie mitschicken) */
export function sameOrigin(request: Request) {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = request.headers.get('origin');
  // Öffentliche Adresse statt request.url (dahinter steht der Reverse-Proxy mit interner Adresse)
  return origin !== null && origin === new URL(serverEnv.webUrl).origin;
}
