# MarktAT

Kleinanzeigenplattform für Österreich (Arbeitstitel) mit den Bereichen Marktplatz, Auto & Motor, Immobilien und Jobs.
Monorepo mit Next.js-Frontend, NestJS-API, PostgreSQL/PostGIS und Supabase Auth.

**Stand: Phase 4 (Suche mit Meilisearch, Filtern und Umkreissuche).** Was genau umgesetzt ist und was nicht, steht unten unter „Stand und Grenzen“.

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
pnpm db:seed -- --demo        # Stammdaten, alle PLZ + gekennzeichnete Demo-Inserate (ohne --demo: nur Stammdaten)
pnpm dev                      # Web und API im Watch-Modus
```

| Dienst | URL |
| --- | --- |
| Web | http://localhost:3000 |
| API | http://localhost:4000/v1/health |
| API-Dokumentation (Swagger) | http://localhost:4000/docs |
| Mailpit (alle E-Mails, z. B. Bestätigungslinks) | http://localhost:8025 |
| Meilisearch | http://localhost:7700 (Schlüssel `MEILI_MASTER_KEY`) |
| Supabase Auth | http://localhost:54321/auth/v1 |
| Postgres | `localhost:5433` (siehe `DATABASE_URL`) |

Produktionsbuild lokal: `pnpm build && pnpm start`. Umgebung stoppen: `pnpm infra:down`
(Daten bleiben im Docker-Volume; komplett löschen mit `docker compose -f infra/docker-compose.yml down -v`).

Erstes Konto: unter `/registrieren` anlegen, den Bestätigungslink in Mailpit öffnen, fertig.

Der Suchindex hält sich selbst aktuell (beim Speichern und beim Start der API). Komplett neu aufbauen, z. B. nach
einem Datenimport: `pnpm --filter @marktat/api search:reindex`. Ohne Meilisearch sucht die API direkt in PostgreSQL.

## Tests und Prüfungen

```bash
pnpm lint
pnpm typecheck
pnpm test                                   # Unit-Tests (shared, ui, api, web)
pnpm --filter @marktat/api test:e2e         # API-Integrationstests gegen marktat_test und den Meilisearch-Index listings_test
pnpm --filter @marktat/web test:e2e         # Playwright, Desktop + Mobil; braucht laufende Umgebung mit Demodaten (pnpm build && pnpm start)
pnpm --filter @marktat/api r2:check         # echte Cloudflare-R2-Verbindung prüfen (Werte aus der lokalen .env)
```

Die API-Integrationstests leeren die Datenbank `marktat_test` (nicht die Entwicklungsdatenbank).
Die CI (`.github/workflows/ci.yml`) führt alles davon bei jedem Pull Request aus.

## Umgebungsvariablen

Alle Variablen sind in [`.env.example`](.env.example) beschrieben. Für die lokale Entwicklung fehlt nichts.
Für spätere Phasen bzw. den Produktionsbetrieb fehlen noch (in `.env.example` mit „FEHLT NOCH“ markiert):

| Variable | Wofür | Ab |
| --- | --- | --- |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_JURISDICTION` | Bild-Uploads (Cloudflare R2), Einrichtung siehe [Bilder](docs/bilder.md); ohne Werte läuft alles außer dem Bild-Upload | Phase 2 |
| `APP_SIGNING_SECRET` | signierte Bild-URLs; lokal ist ein Entwicklungswert gesetzt | Produktion |
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
docs             Architektur, Datenmodell, Suche, Geodaten, Sicherheit, Rechtliches
```

## Dokumentation

- [Architektur](docs/architektur.md)
- [Bilder / Cloudflare R2](docs/bilder.md)
- [Datenmodell](docs/datenmodell.md)
- [Kategorie-Felder (Auto, Immobilien, Jobs, Marktplatz)](docs/kategorie-felder.md)
- [Suche und Filter](docs/suche.md)
- [Geodaten / PLZ-Verzeichnis](docs/geodaten.md)
- [Sicherheit und Backups](docs/sicherheit.md)
- [Rechtliches – Checkliste](docs/rechtliches.md) (⚠️ muss anwaltlich geprüft werden)

## Stand und Grenzen

Umgesetzt:
- Registrierung (privat/gewerblich), E-Mail-Bestätigung, Login, Logout, Passwort vergessen/neu setzen
- Profil bearbeiten (inkl. Firmenangaben)
- Inserat anlegen, als Entwurf speichern, veröffentlichen, bearbeiten, pausieren, fortsetzen, löschen, verlängern
- Startseite, Detailseite, „Meine Anzeigen“
- Kategoriebaum (84 Kategorien) für alle vier Bereiche, Bundesländer und Bezirke vollständig
- Bilder (Phase 2): bis zu 10 pro Inserat über Cloudflare R2, serverseitige Prüfung, EXIF-Entfernung, WebP-Varianten, Hauptbild, Reihenfolge, Löschen
- Kategorieabhängige Felder (Phase 3): Fahrzeugdaten, Wohnfläche/Zimmer/Ausstattung, Gehalt/Arbeitszeit u. v. m. je Unterkategorie, mit Pflichtfeldern, Prüfung in der API und Anzeige auf Detailseite und Karten
- Suche (Phase 4): Meilisearch mit Tippfehlertoleranz und Sortierung nach Relevanz, Datum, Preis und Entfernung; Filter nach Kategorie, Bundesland, PLZ/Ort mit Umkreis, Preis, Anbieter, Zustand und den Eigenschaften je Bereich (Auto, Immobilien, Jobs, Marktplatz); teilbare Such-URLs, Filter-Chips, mobiles Filtermenü; Fallback auf PostgreSQL/PostGIS. Siehe [Suche](docs/suche.md)
- Vollständiges PLZ-Verzeichnis (20.877 Orte, 2.461 PLZ, GeoNames CC BY 4.0) mit Bezirk und Bundesland

Bewusst noch nicht umgesetzt:
- Favoriten, gespeicherte Suchen, Nachrichten, Meldungen, Moderation, Zahlungen
- Rechtstexte sind Platzhalter
