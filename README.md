# MarktAT

Kleinanzeigenplattform für Österreich (Arbeitstitel) mit den Bereichen Marktplatz, Auto & Motor, Immobilien und Jobs.
Monorepo mit Next.js-Frontend, NestJS-API, PostgreSQL/PostGIS und Supabase Auth.

**Stand: Phase 1 (Fundament).** Was genau umgesetzt ist und was nicht, steht unten unter „Stand und Grenzen“.

## Voraussetzungen

- Node.js 22.12 oder neuer (`.nvmrc`)
- pnpm 10 (`corepack enable` aktiviert die Version aus `package.json`)
- Docker mit Docker Compose v2

## Lokal starten

```bash
cp .env.example .env          # nur Entwicklungswerte, funktioniert ohne Änderungen
pnpm install
pnpm infra:up                 # Postgres/PostGIS, Supabase Auth, Mailpit, Redis, Meilisearch
pnpm db:migrate               # Migrationen anwenden
pnpm db:seed -- --demo        # Stammdaten + gekennzeichnete Demo-Inserate (ohne --demo: nur Stammdaten)
pnpm dev                      # Web und API im Watch-Modus
```

| Dienst | URL |
| --- | --- |
| Web | http://localhost:3000 |
| API | http://localhost:4000/v1/health |
| API-Dokumentation (Swagger) | http://localhost:4000/docs |
| Mailpit (alle E-Mails, z. B. Bestätigungslinks) | http://localhost:8025 |
| Supabase Auth | http://localhost:54321/auth/v1 |
| Postgres | `localhost:5433` (siehe `DATABASE_URL`) |

Produktionsbuild lokal: `pnpm build && pnpm start`. Umgebung stoppen: `pnpm infra:down`
(Daten bleiben im Docker-Volume; komplett löschen mit `docker compose -f infra/docker-compose.yml down -v`).

Erstes Konto: unter `/registrieren` anlegen, den Bestätigungslink in Mailpit öffnen, fertig.

## Tests und Prüfungen

```bash
pnpm lint
pnpm typecheck
pnpm test                                   # Unit-Tests (shared, ui, api, web)
pnpm --filter @marktat/api test:e2e         # API-Integrationstests gegen die Testdatenbank marktat_test
pnpm --filter @marktat/web test:e2e         # Playwright, Desktop + Mobil; braucht laufende Umgebung (pnpm build && pnpm start)
```

Die API-Integrationstests leeren die Datenbank `marktat_test` (nicht die Entwicklungsdatenbank).
Die CI (`.github/workflows/ci.yml`) führt alles davon bei jedem Pull Request aus.

## Umgebungsvariablen

Alle Variablen sind in [`.env.example`](.env.example) beschrieben. Für die lokale Entwicklung fehlt nichts.
Für spätere Phasen bzw. den Produktionsbetrieb fehlen noch (in `.env.example` mit „FEHLT NOCH“ markiert):

| Variable | Wofür | Ab |
| --- | --- | --- |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE_URL` | Bild-Uploads (Cloudflare R2) | Phase 2 |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Zahlungen (Testmodus) | Phase 4 |
| `OPENAI_API_KEY` (+ `AI_ENABLED=true`) | optionale KI-Funktionen | Phase 6 |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` | echtes Supabase-Projekt (EU-Region) | Produktion |
| `SMTP_*` | E-Mail-Versand (in Supabase Auth konfigurieren) | Produktion |

## Projektstruktur

```
apps/web         Next.js 16 (App Router, Server Actions, Tailwind 4)
apps/api         NestJS 12, Prisma 7, Migrationen, Seeds, Integrationstests
packages/shared  Zod-Schemas, Enums, Typen, Formatierung
packages/ui      Design-Tokens und Basis-Komponenten
infra            Docker Compose, Auth-Gateway, E-Mail-Vorlagen
docs             Architektur, Datenmodell, Geodaten, Sicherheit, Rechtliches
```

## Dokumentation

- [Architektur](docs/architektur.md)
- [Datenmodell](docs/datenmodell.md)
- [Geodaten / PLZ-Import](docs/geodaten.md)
- [Sicherheit und Backups](docs/sicherheit.md)
- [Rechtliches – Checkliste](docs/rechtliches.md) (⚠️ muss anwaltlich geprüft werden)

## Stand und Grenzen (Phase 1)

Umgesetzt:
- Registrierung (privat/gewerblich), E-Mail-Bestätigung, Login, Logout, Passwort vergessen/neu setzen
- Profil bearbeiten (inkl. Firmenangaben)
- Inserat anlegen, als Entwurf speichern, veröffentlichen, bearbeiten, pausieren, fortsetzen, löschen, verlängern
- Startseite, Suche mit Filtern (Text, Bereich, Kategorie, Bundesland), Detailseite, „Meine Anzeigen“
- Kategoriebaum (84 Kategorien) für alle vier Bereiche, Bundesländer und Bezirke vollständig

Bewusst noch nicht umgesetzt:
- **Bilder** (Tabelle vorhanden, Upload nach R2 in Phase 2)
- **Vollständiges PLZ-Verzeichnis**: lokal nur 140 Entwicklungsorte, Import-Skript siehe [Geodaten](docs/geodaten.md)
- Meilisearch-Suche, Umkreissuche, Favoriten, Nachrichten, Meldungen, Moderation, Zahlungen
- Bereichsspezifische Felder (Kilometerstand, Wohnfläche, Gehalt …)
- Rechtstexte sind Platzhalter
