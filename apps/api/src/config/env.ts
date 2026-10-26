import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_URL: z.url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL fehlt'),
  SUPABASE_URL: z.url(),
  /** HS256-Secret. Leer = Prüfung über JWKS (asymmetrische Supabase-Signaturschlüssel). */
  SUPABASE_JWT_SECRET: z.string().optional().transform((v) => (v ? v : undefined)),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
  /** Optionale KI-Funktionen; ohne Schlüssel bleiben sie abgeschaltet. */
  AI_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

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
