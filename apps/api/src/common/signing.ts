import { createHmac, timingSafeEqual } from 'node:crypto';

/** Signiert eine kurze Nachricht mit HMAC-SHA256 (base64url). */
export function hmac(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('base64url');
}

/** Vergleich in konstanter Zeit, damit sich Signaturen nicht Zeichen für Zeichen erraten lassen. */
export function verifyHmac(secret: string, message: string, signature: string): boolean {
  const expected = Buffer.from(hmac(secret, message));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Packt ein JSON-Objekt samt Signatur in ein URL-taugliches Token: <payload>.<signatur> */
export function signToken(secret: string, payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(secret, body)}`;
}

export function readToken<T>(secret: string, token: string): T | null {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined || !verifyHmac(secret, body, signature))
    return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}
