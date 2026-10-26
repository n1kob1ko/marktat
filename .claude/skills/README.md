# Projekt-Skills

Diese Skills lädt Claude Code automatisch in jeder Session für dieses Repo (lokal und in der Cloud).

## Aus ECC übernommen

Quelle: [affaan-m/ECC](https://github.com/affaan-m/ECC), Version 2.2.3, Commit `25278e7d7b6cf6e6a4e7a6c8e10f14ff22f0eb5b`, MIT-Lizenz (siehe `ECC-LICENSE`).
Die Dateien sind unverändert kopiert. Verweise auf andere ECC-Skills oder `rules/`, die hier nicht enthalten sind, laufen ins Leere und können ignoriert werden.

| Skill | Wofür in MarktAT |
| --- | --- |
| `nestjs-patterns` | Module, DTO-Validierung, Guards, Interceptors in `apps/api` |
| `api-design` | REST-Endpunkte, Pagination, Fehlerformat, Versionierung |
| `contract-first` | OpenAPI als gemeinsamer Vertrag zwischen `apps/api` und `apps/web` |
| `prisma-patterns` | Schema, Queries, Transaktionen, typische Prisma-Fallen |
| `postgres-patterns` | Indizes, Schema-Design, Query-Tuning (PostGIS-Umkreissuche) |
| `database-migrations` | Sichere, rückrollbare Migrationen |
| `redis-patterns` | Caching, Rate-Limiting, Locks, Basis für BullMQ |
| `security-review` | Auth, Uploads, Secrets, Zahlungen (Stripe) |
| `react-patterns` | Server-/Client-Komponenten, Formulare, State |
| `react-performance` | Ladezeit und Rendering in Next.js |
| `frontend-a11y` | Barrierearme Formulare, Modals, Tastaturbedienung |
| `seo` | SEO-freundliche Such- und Detailseiten, Structured Data, Sitemaps |
| `e2e-testing` | Playwright-Tests für die Hauptflows |
| `docker-patterns` | Docker Compose für die lokale Entwicklung |

Prozess-Skills (Planen, TDD, Debugging, Review) kommen bewusst nicht aus ECC, sondern aus dem Superpowers-Plugin, damit sich die Workflows nicht doppeln.
