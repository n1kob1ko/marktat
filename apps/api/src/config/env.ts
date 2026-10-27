import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(4000),
    WEB_URL: z.url().default('http://localhost:3000'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL fehlt'),
    SUPABASE_URL: z.url(),
    /** HS256-Secret. Leer = Prüfung über JWKS (asymmetrische Supabase-Signaturschlüssel). */
    SUPABASE_JWT_SECRET: z
      .string()
      .optional()
      .transform((v) => (v ? v : undefined)),
    /** GEHEIM – Supabase-Admin-API (Kontolöschung). Ohne Schlüssel ist die Kontolöschung nicht verfügbar. */
    SUPABASE_SERVICE_ROLE_KEY: optional,
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
    /**
     * Express `trust proxy`: Anzahl vertrauenswürdiger Proxys vor der API (z. B. 1 hinter einem Load-Balancer).
     * 0 = keine (Standard). Nur setzen, wenn der Proxy X-Forwarded-For selbst überschreibt.
     */
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    /** Optionale KI-Funktionen; ohne Schlüssel bleiben sie abgeschaltet. */
    AI_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    /** Öffentliche URL der API (für Bild-URLs und den lokalen Speichertreiber) */
    API_URL: z.url().default('http://localhost:4000'),
    /** Geheimnis für signierte Bild-Vorschau-URLs und den lokalen Speichertreiber (min. 32 Zeichen) */
    APP_SIGNING_SECRET: optional.pipe(
      z.string().min(32, 'APP_SIGNING_SECRET muss mindestens 32 Zeichen lang sein.').optional(),
    ),
    /** r2 = Cloudflare R2 (Standard), local = Dateisystem (nur Tests/Offline-Entwicklung, nie in Produktion) */
    STORAGE_DRIVER: z.enum(['r2', 'local']).default('r2'),
    LOCAL_STORAGE_DIR: optional,
    R2_ACCOUNT_ID: optional,
    R2_ACCESS_KEY_ID: optional,
    R2_SECRET_ACCESS_KEY: optional,
    R2_BUCKET: optional,
    /** default | eu | fedramp – muss zur Jurisdiktion des Buckets passen */
    R2_JURISDICTION: z.enum(['default', 'eu', 'fedramp']).default('default'),
    /** Optional: S3-Endpoint explizit setzen (überschreibt Account-ID + Jurisdiktion) */
    R2_ENDPOINT: z
      .string()
      .optional()
      .transform((v) => (v ? v : undefined))
      .pipe(z.url().optional()),
    /** Meilisearch für die Volltextsuche. Leer = Suche nur über PostgreSQL (Fallback). */
    MEILI_URL: optional.pipe(z.url().optional()),
    MEILI_MASTER_KEY: optional,
    /** Name des Suchindex (Tests verwenden einen eigenen) */
    MEILI_INDEX: z.string().regex(/^[a-zA-Z0-9_-]+$/).default('listings'),
    /** Redis für Hintergrundaufgaben (BullMQ) und Echtzeit-Ereignisse über mehrere API-Instanzen. Leer = im Prozess. */
    REDIS_URL: optional.pipe(z.url().optional()),
    /** Präfix der Warteschlangen in Redis (Tests verwenden ein eigenes) */
    QUEUE_PREFIX: z.string().regex(/^[a-zA-Z0-9_-]+$/).default('marktat'),
    /** false = diese Instanz arbeitet keine Hintergrundaufgaben ab (z. B. reine Web-Instanzen) */
    JOBS_WORKER: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    /** E-Mail-Versand (lokal: Mailpit). Leer = E-Mails werden nur protokolliert. */
    SMTP_HOST: optional,
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: optional,
    SMTP_PASSWORD: optional,
    /** true = TLS ab Verbindungsbeginn (Port 465); sonst STARTTLS, falls der Server es anbietet */
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    MAIL_FROM: z.string().min(3).default('MarktAT <noreply@marktat.local>'),
    /** Wartezeit vor der E-Mail zu einer neuen Nachricht. Wer in dieser Zeit liest, bekommt keine E-Mail. */
    MESSAGE_EMAIL_DELAY_SECONDS: z.coerce.number().int().min(0).max(86_400).default(120),
    /** Abstand der Prüfung gespeicherter Suchen auf neue Treffer */
    SAVED_SEARCH_ALERT_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
    /**
     * Stripe (Phase 7) – nur für den späteren kostenpflichtigen Betrieb. Ohne Schlüssel läuft die Plattform
     * normal weiter (kostenlos). Erlaubt sind Testschlüssel (sk_test_/rk_test_); Live-Schlüssel nur mit
     * STRIPE_LIVE_ENABLED=true – das erst nach ausdrücklicher Freigabe setzen (docs/monetarisierung.md).
     */
    STRIPE_SECRET_KEY: optional,
    STRIPE_WEBHOOK_SECRET: optional,
    STRIPE_LIVE_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    /** Basis-URL der Stripe-API (nur Tests überschreiben sie) */
    STRIPE_API_URL: z.url().default('https://api.stripe.com'),
    /**
     * Zwei-Faktor-Anmeldung (TOTP) für Moderation und Administration Pflicht. Leer = in Produktion an, sonst aus
     * (lokal kann der Admin-Bereich dann ohne 2FA geöffnet werden; wer 2FA eingerichtet hat, braucht sie trotzdem).
     */
    STAFF_MFA_REQUIRED: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
    /** Kritische Admin-Aktionen verlangen einen 2FA-Code, der höchstens so alt ist (Minuten) */
    STEP_UP_MAX_AGE_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
    /** Log-Format: pretty (lesbar, Standard lokal) oder json (eine Zeile je Eintrag, Standard in Produktion) */
    LOG_FORMAT: z.enum(['pretty', 'json']).optional(),
    /**
     * Deals (Phase 10): Angebotslinks regelmäßig prüfen (nur öffentliche https-Adressen, siehe common/safe-fetch.ts).
     * false = keine ausgehenden Prüfungen (z. B. Umgebung ohne Internetzugang).
     */
    DEAL_LINK_CHECK: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    /** Nur Tests: ausgehende Abrufe an lokale Testserver (http, 127.0.0.1) erlauben. In Produktion verboten. */
    OUTBOUND_ALLOW_PRIVATE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .refine((env) => env.NODE_ENV !== 'production' || !env.OUTBOUND_ALLOW_PRIVATE, {
    message: 'OUTBOUND_ALLOW_PRIVATE ist nur für Tests gedacht und in Produktion verboten.',
    path: ['OUTBOUND_ALLOW_PRIVATE'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.APP_SIGNING_SECRET, {
    message: 'APP_SIGNING_SECRET ist in Produktion Pflicht.',
    path: ['APP_SIGNING_SECRET'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.SUPABASE_SERVICE_ROLE_KEY, {
    message: 'SUPABASE_SERVICE_ROLE_KEY ist in Produktion Pflicht (Kontolöschung nach DSGVO).',
    path: ['SUPABASE_SERVICE_ROLE_KEY'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.STORAGE_DRIVER === 'r2', {
    message: 'STORAGE_DRIVER=local ist in Produktion nicht erlaubt.',
    path: ['STORAGE_DRIVER'],
  })
  // Online-Betrieb: ohne diese Werte kämen Benachrichtigungen nicht an bzw. Links in E-Mails zeigten ins Leere
  .refine((env) => env.NODE_ENV !== 'production' || env.SMTP_HOST, {
    message: 'SMTP_HOST ist in Produktion Pflicht (sonst werden E-Mails nur protokolliert).',
    path: ['SMTP_HOST'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || !/\.local>?\s*$/.test(env.MAIL_FROM), {
    message: 'MAIL_FROM braucht in Produktion eine echte, verifizierte Absenderadresse.',
    path: ['MAIL_FROM'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.WEB_URL.startsWith('https://'), {
    message: 'WEB_URL muss in Produktion mit https:// beginnen.',
    path: ['WEB_URL'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || !env.MEILI_URL || (env.MEILI_MASTER_KEY?.length ?? 0) >= 16, {
    message: 'MEILI_MASTER_KEY muss in Produktion mindestens 16 Zeichen lang sein.',
    path: ['MEILI_MASTER_KEY'],
  });

export type Env = z.infer<typeof envSchema>;

/** Nur für Entwicklung und Tests; in Produktion erzwingt das Schema einen eigenen Wert. */
const DEV_SIGNING_SECRET = 'marktat-dev-signing-secret-not-for-production-0123';

/** 2FA-Pflicht für Moderation und Administration (Standard: nur in Produktion) */
export function staffMfaRequired(env: Env): boolean {
  return env.STAFF_MFA_REQUIRED ?? env.NODE_ENV === 'production';
}

export function signingSecret(env: Env): string {
  return env.APP_SIGNING_SECRET ?? DEV_SIGNING_SECRET;
}

let cached: Env | undefined;

/** Lädt ../../.env (falls vorhanden) und validiert die Umgebung. Bricht beim Start ab, wenn etwas fehlt. */
export function loadEnv(): Env {
  if (cached) return cached;
  const rootEnv = fileURLToPath(new URL('../../../../.env', import.meta.url));
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Ungültige Umgebungsvariablen:\n${details}`);
  }
  cached = parsed.data;
  return cached;
}

/** Nur für Tests: erlaubt, die Umgebung nach Änderungen an process.env neu einzulesen. */
export function resetEnvCache() {
  cached = undefined;
}
