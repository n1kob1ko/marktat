import { createHmac } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** TOTP nach RFC 6238 (SHA-1, 30 s, 6 Ziffern) – wie jede Authenticator-App */
export function totp(secret: string, counter = Math.floor(Date.now() / 30_000)): string {
  const bits = secret
    .replace(/[\s=]/g, '')
    .toUpperCase()
    .split('')
    .map((ch) => BASE32.indexOf(ch).toString(2).padStart(5, '0'))
    .join('');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hash = createHmac('sha1', key).update(message).digest();
  const offset = hash[hash.length - 1]! & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

const used = new Map<string, number>();

/** Neuer Code je Aufruf: wartet bei Bedarf auf das nächste 30-Sekunden-Fenster (Codes sind nur einmal gültig). */
export async function nextTotp(secret: string): Promise<string> {
  let counter = Math.floor(Date.now() / 30_000);
  // Kurz vor dem Wechsel lieber warten, damit der Code beim Absenden noch gilt
  const remaining = 30_000 - (Date.now() % 30_000);
  if ((used.get(secret) ?? -1) >= counter || remaining < 3_000) {
    await new Promise((resolve) => setTimeout(resolve, remaining + 200));
    counter = Math.floor(Date.now() / 30_000);
  }
  used.set(secret, counter);
  return totp(secret, counter);
}
