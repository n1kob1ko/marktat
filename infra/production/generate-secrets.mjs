#!/usr/bin/env node
/**
 * Erzeugt zufällige Geheimnisse für eine MarktAT-Umgebung und trägt sie in die .env ein.
 *
 *   node generate-secrets.mjs .env
 *
 * Füllt nur LEERE bzw. fehlende Einträge; vorhandene Werte bleiben unverändert. Ein erneuter Aufruf ist daher
 * gefahrlos (neue Datenbank-, Redis- oder JWT-Geheimnisse passten nicht mehr zu den vorhandenen Daten bzw. meldeten
 * alle ab). Gibt keine Werte aus. Läuft ohne Abhängigkeiten (nur Node.js).
 */
import { createHmac, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

// Hex: sicher in URLs (DATABASE_URL, REDIS_URL) und Shell-Variablen, ohne Escaping
const hex = (bytes) => randomBytes(bytes).toString('hex');
const base64url = (value) => Buffer.from(value).toString('base64url');

/** HS256-JWT wie bei Supabase: anon (öffentlich) und service_role (geheim), 10 Jahre gültig */
function supabaseKey(role, secret) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iss: 'supabase', role, iat: now, exp: now + 10 * 365 * 24 * 3600 }));
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error('Aufruf: node generate-secrets.mjs <pfad/zur/.env>  (Datei vorher aus env.production.example anlegen)');
  process.exit(1);
}
const lines = readFileSync(file, 'utf8').split('\n');
const current = (key) => lines.find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1).trim() ?? '';

// Anon- und Service-Role-Key müssen mit genau diesem JWT-Secret signiert sein: nur gemeinsam neu erzeugen
const jwtSecret = current('SUPABASE_JWT_SECRET') || hex(32);
const jwtFresh = !current('SUPABASE_JWT_SECRET');
if (!jwtFresh && (!current('SUPABASE_ANON_KEY') || !current('SUPABASE_SERVICE_ROLE_KEY'))) {
  console.error('SUPABASE_JWT_SECRET ist gesetzt, aber ein Supabase-Key fehlt. Keys von Hand ergänzen oder alle drei leeren.');
  process.exit(1);
}
const generators = {
  POSTGRES_PASSWORD: () => hex(24),
  REDIS_PASSWORD: () => hex(24),
  MEILI_MASTER_KEY: () => hex(24),
  SUPABASE_JWT_SECRET: () => jwtSecret,
  SUPABASE_ANON_KEY: () => supabaseKey('anon', jwtSecret),
  SUPABASE_SERVICE_ROLE_KEY: () => supabaseKey('service_role', jwtSecret),
  APP_SIGNING_SECRET: () => hex(32),
  BACKUP_PASSPHRASE: () => hex(32),
};

const filled = [];
for (const [key, generate] of Object.entries(generators)) {
  if (current(key)) continue;
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (index >= 0) lines[index] = `${key}=${generate()}`;
  else lines.push(`${key}=${generate()}`);
  filled.push(key);
}
writeFileSync(file, lines.join('\n'));
chmodSync(file, 0o600);
console.log(filled.length ? `Neu gesetzt: ${filled.join(', ')}` : 'Alle Geheimnisse waren schon gesetzt – nichts geändert.');
