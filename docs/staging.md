# Staging-Strategie (nur Konzept – nichts bereitgestellt)

> Stand 27.10.2026: Es gibt **keine** Staging- oder Produktionsumgebung. Die Produktion ist seit Phase 9 fertig
> vorbereitet ([deployment.md](deployment.md)); eine zweite Umgebung lässt sich mit denselben Dateien auf einem
> weiteren Server aufsetzen. Bis dahin ersetzt die lokale Generalprobe (`infra/production/probe/`) Staging.
> Dieses Dokument beschreibt, wie eine
> Staging-Umgebung aussehen soll. Bereitstellung, Anbieterwahl und alle Kosten brauchen Nikos Freigabe.

## Ziel

Eine Umgebung, die der späteren Produktion möglichst gleicht, auf der jeder Stand vor dem Livegang geprüft wird –
ohne echte Personendaten und ohne echte Zahlungen.

## Aufbau

| Baustein | Staging | Hinweis |
| --- | --- | --- |
| Web (Next.js) | eigene Instanz, eigene Domain (z. B. `staging.<domain>`) | mit HTTP-Basic-Auth oder IP-Sperre davor; `ALLOW_INDEXING` **nicht** setzen |
| API (NestJS) | eigene Instanz, `NODE_ENV=production`, `LOG_FORMAT=json` | `STAFF_MFA_REQUIRED=true` wie in Produktion |
| PostgreSQL + PostGIS | eigene Datenbank, getrennt von Produktion | nur synthetische Daten (`pnpm db:seed -- --demo`), nie Kopien der Produktionsdaten |
| Supabase Auth | eigenes Projekt bzw. eigene GoTrue-Instanz | eigene Schlüssel; E-Mails an Testpostfach |
| Meilisearch | eigene Instanz oder eigener Index-Präfix | |
| Redis | eigene Instanz oder eigener `QUEUE_PREFIX` | |
| Bilder | eigener R2-Bucket (z. B. `marktat-staging`) | nicht der Entwicklungs- oder Produktionsbucket |
| E-Mail | Mailpit oder Sandbox-Modus des Versanddienstes | kein Versand an echte Adressen |
| Stripe | **nur Testmodus** | Live-Schlüssel nie in Staging; Betriebsmodus bleibt `FREE` |

## Ablauf

1. Pull Request → CI (Build, Lint, Typecheck, Unit-, API- und Browser-Tests, Migrationsprüfung, Sicherungsprobe, Audit).
2. Nach dem Merge auf `main`: automatische Bereitstellung auf Staging (Build mit denselben Befehlen wie in der CI).
3. Migrationen laufen vor dem Start der neuen API-Version (`prisma migrate deploy`); vorher Sicherung.
4. Rauchtest auf Staging: `GET /v1/health/ready` = `ok`, Playwright-Suite gegen `E2E_BASE_URL=https://staging…`
   (die Tests brauchen Mailpit-Zugriff; alternativ nur die lesenden Tests).
5. Freigabe für Produktion von Hand (Tag/Release), gleiche Artefakte wie auf Staging.

## Geheimnisse

- Je Umgebung eigene Schlüssel (Supabase JWT-Secret, Service-Role-Key, R2, Stripe-Test, SMTP).
- Ablage im Secret-Store des Hosters bzw. in GitHub Environments, nie im Repository.

## Offene Entscheidungen

- Hoster für Web und API (EU-Rechenzentrum), verwaltete Datenbank, Kosten.
- Domain und TLS.
- Ob Staging dauerhaft läuft oder nur bei Bedarf gestartet wird (Kosten).
- Wer Zugang zu Staging bekommt.
