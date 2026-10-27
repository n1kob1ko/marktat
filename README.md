# MarktAT

Kleinanzeigenplattform für Österreich (Arbeitstitel) mit den Bereichen Marktplatz, Auto & Motor, Immobilien und Jobs.
Monorepo mit Next.js-Frontend, NestJS-API, PostgreSQL/PostGIS und Supabase Auth.

**Stand: Phase 7 (kostenloser Plattformstart, Monetarisierung vorbereitet, Händlerfunktionen).** Die Plattform ist
vollständig kostenlos; es gibt keine echten Zahlungen. Was genau umgesetzt ist und was nicht, steht unten unter „Stand und Grenzen“.

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
pnpm --filter @marktat/web test:e2e         # Playwright, Desktop + Mobil; braucht laufende Umgebung mit Demodaten (pnpm build && pnpm start),
                                            # für die Nachrichten-Tests die API mit MESSAGE_EMAIL_DELAY_SECONDS=0 (direkt starten:
                                            # turbo reicht die Variable nicht durch: cd apps/api && MESSAGE_EMAIL_DELAY_SECONDS=0 node dist/main.js)
pnpm --filter @marktat/api r2:check         # echte Cloudflare-R2-Verbindung prüfen (Werte aus der lokalen .env)
```

Die API-Integrationstests leeren die Datenbank `marktat_test` (nicht die Entwicklungsdatenbank). Die Tests zu
Kontolöschung und Datenexport legen echte Testkonten in Supabase Auth an und brauchen daher `auth` und `gateway` aus
`pnpm infra:up`.

## Erstes Administratorkonto

Rollen gibt es nur in der Datenbank – kein Standardpasswort, kein öffentlicher Einrichtungs-Endpunkt. Konto normal
registrieren, E-Mail bestätigen, einmal anmelden, dann auf dem Server:

```bash
pnpm --filter @marktat/api admin:role -- --email anna@example.at --role ADMIN
pnpm --filter @marktat/api admin:role -- --list
```

Weitere Moderatorinnen und Moderatoren ernennen Admins danach unter `/admin/nutzer`. Details: [Moderation](docs/moderation.md).
Die CI (`.github/workflows/ci.yml`) führt alles davon bei jedem Pull Request aus.

## Umgebungsvariablen

Alle Variablen sind in [`.env.example`](.env.example) beschrieben. Für die lokale Entwicklung fehlt nichts.
Für spätere Phasen bzw. den Produktionsbetrieb fehlen noch (in `.env.example` mit „FEHLT NOCH“ markiert):

| Variable | Wofür | Ab |
| --- | --- | --- |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_JURISDICTION` | Bild-Uploads (Cloudflare R2), Einrichtung siehe [Bilder](docs/bilder.md); ohne Werte läuft alles außer dem Bild-Upload | Phase 2 |
| `APP_SIGNING_SECRET` | signierte Bild-URLs; lokal ist ein Entwicklungswert gesetzt | Produktion |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Zahlungen, nur Testmodus (`sk_test_…`); ohne Werte läuft alles kostenlos weiter. `STRIPE_LIVE_ENABLED` bleibt `false`, bis der Live-Modus ausdrücklich freigegeben ist. Siehe [Monetarisierung](docs/monetarisierung.md) | erst für den kostenpflichtigen Betrieb |
| `OPENAI_API_KEY` (+ `AI_ENABLED=true`) | optionale KI-Funktionen | Phase 6 |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` | echtes Supabase-Projekt (EU-Region) | Produktion |
| `SMTP_*`, `MAIL_FROM` | E-Mail-Versand: in Supabase Auth (Kontomails) und in der API (Nachrichten, Suchaufträge); lokal Mailpit | Produktion |
| `REDIS_URL` | Hintergrundaufträge (BullMQ) und Echtzeit über mehrere Instanzen; lokal gesetzt | Produktion |

## Projektstruktur

```
apps/web         Next.js 16 (App Router, Server Actions, Tailwind 4)
apps/api         NestJS 12, Prisma 7, Migrationen, Seeds, Integrationstests
packages/shared  Zod-Schemas, Enums, Typen, Formatierung
packages/ui      Design-Tokens und Basis-Komponenten
infra            Docker Compose, Auth-Gateway, E-Mail-Vorlagen
docs             Architektur, Datenmodell, Suche, Geodaten, Moderation, Monetarisierung, Händler, Datenschutz, Sicherheit, Rechtliches
```

## Dokumentation

- [Architektur](docs/architektur.md)
- [Bilder / Cloudflare R2](docs/bilder.md)
- [Datenmodell](docs/datenmodell.md)
- [Kategorie-Felder (Auto, Immobilien, Jobs, Marktplatz)](docs/kategorie-felder.md)
- [Suche und Filter](docs/suche.md)
- [Merkliste, gespeicherte Suchen, Nachrichten](docs/nachrichten.md)
- [Moderation, Rollen, Meldungen, Einsprüche](docs/moderation.md)
- [Monetarisierung: Preise, Einführungsaktion, Zusatzleistungen, Stripe](docs/monetarisierung.md)
- [Händlerprofil, Händler-Dashboard, Statistik](docs/haendler.md)
- [Datenschutz: Export, Kontolöschung, Löschfristen](docs/datenschutz.md)
- [Geodaten / PLZ-Verzeichnis](docs/geodaten.md)
- [Sicherheit und Backups](docs/sicherheit.md)
- [Online-Betrieb: Hosting, Kosten, Ersteinrichtung, Updates, Sicherungen](docs/deployment.md)
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
- Merkliste, gespeicherte Suchen und Nachrichten (Phase 5): Herz auf Karten und Detailseite, Merkliste im Konto; Suchen mit allen Filtern speichern, umbenennen, erneut ausführen, löschen, optional E-Mail bei neuen Treffern; Nachrichten je Anzeige mit Postfach (Filter, Suche, ungelesen), Chat in Echtzeit (Server-Sent Events), Lesebestätigung, Ungelesen-Zähler im Header, E-Mail bei neuen Nachrichten (Mailpit), Blockieren und Melden. Siehe [Nachrichten](docs/nachrichten.md)
- Moderation und Admin-Bereich (Phase 6): Rollen USER/MODERATOR/ADMIN nur aus der Datenbank, Admin per Kommandozeile; Meldeformular für Inserate (Art. 16 DSA) mit Priorität, Verlauf, Duplikat- und Missbrauchsschutz; Dashboard mit Kennzahlen, Warteschlangen, Registrierungen, Auftragsfehlern und Ereignissen; Inserate prüfen, deaktivieren, ausblenden, freigeben; Konten sperren und entsperren; Einsprüche; Mitteilungen im Konto und per E-Mail; Audit-Log; Nachrichteneinsicht nur zu offenen Meldungen und protokolliert. Siehe [Moderation](docs/moderation.md)
- Datenschutz (Phase 6): Datenexport als JSON, Kontolöschung mit erneuter Passwortprüfung und wiederholbaren Löschschritten, tägliche Aufbewahrungsbereinigung. Siehe [Datenschutz](docs/datenschutz.md)
- Monetarisierung (Phase 7): kostenloser Betrieb als Standard; Leistungen Inserat, Hervorhebung, Top-Anzeige und Hochschieben mit Laufzeit, Limits gegen Missbrauch und automatischem Ablauf; Einführungsaktion; Preisverwaltung, Aktionszeiträume, Limits, Buchungsübersicht und Betriebsmodus unter `/admin/monetarisierung`; einheitliche, idempotente Buchungen mit Preis-Schnappschuss; Stripe Checkout und Webhooks im Testmodus vorbereitet (Live gesperrt). Siehe [Monetarisierung](docs/monetarisierung.md)
- Händlerfunktionen und Statistik (Phase 7): öffentliches Händlerprofil mit Logo, Händler-Dashboard, Aufrufstatistik je Anzeige ohne Eigen-, Team- und Bot-Aufrufe. Siehe [Händler](docs/haendler.md)
- Vollständiges PLZ-Verzeichnis (20.877 Orte, 2.461 PLZ, GeoNames CC BY 4.0) mit Bezirk und Bundesland

Bewusst noch nicht umgesetzt:
- Echte Zahlungen (nur vorbereitet, Testmodus nicht mit echten Stripe-Schlüsseln geprüft), Rechnungen, Händlerpakete; Bilder in Nachrichten, Push-Benachrichtigungen, 2FA für Team-Konten, Monitoring/Alarmierung (siehe [Sicherheit](docs/sicherheit.md))
- Rechtstexte sind Platzhalter
