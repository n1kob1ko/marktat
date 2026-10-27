import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

// Gemeinsame .env im Repo-Wurzelverzeichnis laden (Prisma 7 lädt .env-Dateien nicht automatisch).
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed/seed.ts',
  },
  datasource: {
    // Platzhalter erlaubt `prisma generate` ohne Datenbank (z. B. in CI vor dem Build).
    url: process.env.DATABASE_URL ?? 'postgresql://invalid:invalid@localhost:5432/invalid',
    // Nur für `db:check-migrations`: eigene, leere Datenbank (Prisma setzt sie bei jeder Prüfung zurück)
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
