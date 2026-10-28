import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from './env.js';

export interface CheckResult {
  errors: string[];
  warnings: string[];
}

/** Werte aus der lokalen Entwicklungsumgebung (.env.example) – dürfen online nie auftauchen */
const DEV_MARKERS = ['marktat_dev_pw', 'marktat-local-dev', 'marktat_dev_meili', 'change-me', 'change_me', 'supabase-local'];

function jwtClaims(token: string, secret: string): Record<string, unknown> | null {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) return null;
  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Zusätzliche Prüfungen vor einem Online-Deployment (über das Schema in env.ts hinaus). Nennt nur Namen von
 * Variablen, nie deren Werte. `raw` ist process.env (für Werte, die die API selbst nicht liest).
 */
export function checkProductionEnv(env: Env, raw: Record<string, string | undefined>): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (env.NODE_ENV !== 'production') errors.push('NODE_ENV muss production sein.');

  const secrets = {
    SUPABASE_JWT_SECRET: env.SUPABASE_JWT_SECRET,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_ANON_KEY: raw.SUPABASE_ANON_KEY,
    APP_SIGNING_SECRET: env.APP_SIGNING_SECRET,
    MEILI_MASTER_KEY: env.MEILI_MASTER_KEY,
    DATABASE_URL: env.DATABASE_URL,
    REDIS_URL: env.REDIS_URL,
    R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
    SMTP_PASSWORD: env.SMTP_PASSWORD,
  };
  for (const [name, value] of Object.entries(secrets)) {
    if (value && DEV_MARKERS.some((marker) => value.includes(marker))) {
      errors.push(`${name} enthält einen Entwicklungswert – mit generate-secrets.mjs neu erzeugen.`);
    }
  }
  for (const name of ['SUPABASE_JWT_SECRET', 'APP_SIGNING_SECRET'] as const) {
    if ((env[name]?.length ?? 0) < 32) errors.push(`${name} fehlt oder ist kürzer als 32 Zeichen.`);
  }
  if (!env.REDIS_URL) errors.push('REDIS_URL fehlt (Hintergrundaufgaben und E-Mails brauchen Redis).');
  else if (!new URL(env.REDIS_URL).password) errors.push('REDIS_URL ohne Passwort.');
  if (!env.MEILI_URL) warnings.push('MEILI_URL fehlt – die Suche läuft dann nur über PostgreSQL.');

  // Awin: nur mit vollständigen Zugangsdaten und nur gegen die offiziellen Adressen
  if (env.AWIN_ENABLED) {
    for (const name of ['AWIN_PUBLISHER_ID', 'AWIN_API_TOKEN', 'AWIN_FEED_API_KEY'] as const) {
      if (!env[name]) errors.push(`${name} fehlt (AWIN_ENABLED=true).`);
    }
    if (env.AWIN_API_URL !== 'https://api.awin.com') errors.push('AWIN_API_URL ist nur für Tests änderbar.');
    if (env.AWIN_PRODUCTDATA_URL !== 'https://productdata.awin.com') errors.push('AWIN_PRODUCTDATA_URL ist nur für Tests änderbar.');
  }

  // Supabase-Schlüssel müssen mit dem JWT-Secret signiert sein und die richtige Rolle tragen
  if (env.SUPABASE_JWT_SECRET) {
    for (const [name, role] of [
      ['SUPABASE_ANON_KEY', 'anon'],
      ['SUPABASE_SERVICE_ROLE_KEY', 'service_role'],
    ] as const) {
      const token = secrets[name];
      const claims = token ? jwtClaims(token, env.SUPABASE_JWT_SECRET) : null;
      if (!claims) errors.push(`${name} fehlt oder ist nicht mit SUPABASE_JWT_SECRET signiert.`);
      else if (claims.role !== role) errors.push(`${name} hat die falsche Rolle (erwartet: ${role}).`);
    }
  }

  // Bilder: eigener Produktions-Bucket mit vollständigen Zugangsdaten
  for (const name of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const) {
    if (!env[name] && !(name === 'R2_ACCOUNT_ID' && env.R2_ENDPOINT)) errors.push(`${name} fehlt.`);
  }
  if (env.R2_BUCKET && /dev|test|staging/i.test(env.R2_BUCKET)) {
    errors.push('R2_BUCKET sieht nach einem Entwicklungs- oder Test-Bucket aus – eigenen Produktions-Bucket anlegen.');
  }
  if (raw.BACKUP_R2_BUCKET && raw.BACKUP_R2_BUCKET === env.R2_BUCKET) {
    errors.push('BACKUP_R2_BUCKET darf nicht der Bilder-Bucket sein.');
  }

  // E-Mail
  if (!env.SMTP_USER || !env.SMTP_PASSWORD) warnings.push('SMTP_USER/SMTP_PASSWORD leer – fast alle Versanddienste verlangen eine Anmeldung.');
  if (!env.SMTP_SECURE && env.SMTP_PORT === 465) errors.push('SMTP_PORT 465 braucht SMTP_SECURE=true.');
  const fromAddress = /<([^>]+)>/.exec(env.MAIL_FROM)?.[1] ?? env.MAIL_FROM;
  if (!raw.MAIL_FROM_ADDRESS) errors.push('MAIL_FROM_ADDRESS fehlt (Absender der Bestätigungs-E-Mails).');
  else if (raw.MAIL_FROM_ADDRESS.trim() !== fromAddress.trim()) {
    warnings.push('MAIL_FROM und MAIL_FROM_ADDRESS nutzen verschiedene Adressen – beide müssen beim Versanddienst verifiziert sein.');
  }
  if (/example\.(at|com|org)/i.test(env.MAIL_FROM)) errors.push('MAIL_FROM ist noch die Beispieladresse.');

  // Sicherheit und kostenloser Betrieb
  if (env.STAFF_MFA_REQUIRED === false) errors.push('STAFF_MFA_REQUIRED=false – im Online-Betrieb ist 2FA für das Team Pflicht.');
  if (env.TRUST_PROXY !== 1) warnings.push('TRUST_PROXY ist nicht 1 – hinter Caddy zählen Rate-Limits sonst falsch.');
  if (env.STRIPE_LIVE_ENABLED) errors.push('STRIPE_LIVE_ENABLED=true – echte Zahlungen sind nicht freigegeben.');
  if (env.STRIPE_SECRET_KEY?.startsWith('sk_live_') || env.STRIPE_SECRET_KEY?.startsWith('rk_live_')) {
    errors.push('STRIPE_SECRET_KEY ist ein Live-Schlüssel – nicht freigegeben.');
  }
  if (env.AI_ENABLED) warnings.push('AI_ENABLED=true – KI-Funktionen senden Inhalte an einen externen Dienst (Datenschutzerklärung prüfen).');
  if (!raw.BACKUP_PASSPHRASE || raw.BACKUP_PASSPHRASE.length < 32) {
    errors.push('BACKUP_PASSPHRASE fehlt oder ist kürzer als 32 Zeichen (Sicherungen wären unverschlüsselt).');
  }

  return { errors, warnings };
}
