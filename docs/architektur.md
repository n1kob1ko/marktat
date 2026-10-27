# Architektur

Stand: Phase 2 (Bild-Upload). Dieses Dokument beschreibt, was gebaut ist, und markiert Geplantes ausdrücklich als „geplant“.

## Überblick

```
Browser ──► apps/web (Next.js 16, Server Components, Server Actions)
              │  Supabase-Sitzung in HttpOnly-Cookies (@supabase/ssr)
              │  Access-Token als Bearer
              ▼
            apps/api (NestJS 12, REST unter /v1, OpenAPI unter /docs)
              │            │
              ▼            ▼
        PostgreSQL 16   Supabase Auth (GoTrue)         Cloudflare R2 (privat)
        + PostGIS       Registrierung, Login, …        Bilder; Browser lädt per signierter URL direkt hoch

geplant: Meilisearch (Suche), Redis/BullMQ (Jobs), Stripe (Zahlungen), OpenAI (optional)
```

Der Browser spricht für Auth direkt mit Supabase Auth (über die Server Actions der Web-App), für alle Fachdaten ausschließlich mit der API. Die API vertraut nur dem signierten JWT, nicht den Angaben des Clients.

## Monorepo

| Pfad | Inhalt |
| --- | --- |
| `apps/web` | Next.js-Frontend: Seiten, Server Actions, Formulare, SEO-Grundlagen |
| `apps/api` | NestJS-API, Prisma-Schema, Migrationen, Seeds, Integrationstests |
| `packages/shared` | Zod-Schemas, Enums, Typen und Formatierung – gemeinsam für Web und API |
| `packages/ui` | Design-Tokens (Tailwind 4 `@theme`) und Basis-Komponenten |
| `infra` | Docker Compose für die lokale Umgebung, E-Mail-Vorlagen, Gateway |
| `docs` | Diese Dokumentation |

Werkzeuge: pnpm-Workspaces, Turborepo (`build`, `dev`, `lint`, `typecheck`, `test`, `test:e2e`), TypeScript 6.0 (TS 7 wird von Nest CLI und Teilen des Ökosystems noch nicht unterstützt).

## Entscheidungen

- **Validierung einmal, überall:** Zod-Schemas in `packages/shared` validieren Formulare in der Web-App und Requests in der API (`ZodValidationPipe`). Fehlermeldungen sind deutsch (`z.config(z.locales.de())` plus eigene Texte).
- **Auth über Supabase, Profil in eigener DB:** Supabase Auth verwaltet Passwörter, Sitzungen und E-Mails. Die API legt beim ersten authentifizierten Request ein Profil (`users`) mit derselben UUID an. Rollen (USER, MODERATOR, ADMIN) stehen nur in unserer DB, nie in Token-Metadaten, die Nutzer selbst ändern können.
- **Token-Prüfung:** HS256 mit `SUPABASE_JWT_SECRET` oder – bei asymmetrischen Supabase-Schlüsseln – per JWKS. Geprüft werden Signatur, Ablauf, Issuer, Audience und `role = authenticated`.
- **Lokal ohne Cloud-Konto:** GoTrue (dieselbe Software wie Supabase Auth) läuft in Docker hinter einem nginx-Gateway mit identischem Pfad `/auth/v1`. Mails landen in Mailpit.
- **Inserat-Lebenszyklus:** `DRAFT → ACTIVE ⇄ PAUSED`, `ACTIVE → EXPIRED` (nach 60 Tagen, berechnet über `expiresAt`), `DELETED` als Soft-Delete. `PENDING_REVIEW` und `REJECTED` sind für die Moderation (Phase 3) angelegt. Veröffentlichen verlangt eine Blattkategorie, Titel, Beschreibung, Preisart und Ort.
- **Fremde Inserate:** Zugriffe auf Inserate anderer Nutzer liefern 404 statt 403, damit keine IDs erraten werden können.
- **Caching im Frontend:** Öffentliche Daten (Kategorien, neueste Inserate) mit `'use cache'` + `cacheTag`, nach Änderungen `updateTag('listings')`. Nutzerabhängige Teile liegen in `Suspense`-Grenzen.
- **Suche in Phase 1:** einfache Postgres-Suche (`ILIKE` auf Titel/Beschreibung) mit Filtern nach Kategorie (inkl. Unterkategorien), Bereich und Bundesland. Meilisearch folgt in Phase 2.
- **Geodaten:** Bundesland → Bezirk → Ort (PLZ) mit PostGIS-Punkt für spätere Umkreissuche. Siehe [geodaten.md](geodaten.md).
- **Bilder:** Upload direkt vom Browser nach R2 über kurzlebige Presigned-URLs, danach Prüfung und Optimierung in der API (sharp), Auslieferung über stabile API-URLs mit Weiterleitung auf signierte R2-URLs. Austauschbarer Speicher (`ObjectStorage`): R2 oder lokales Dateisystem für Tests. Siehe [bilder.md](bilder.md).

## API-Endpunkte (Phase 1)

| Methode | Pfad | Zugriff |
| --- | --- | --- |
| GET | `/v1/health` | öffentlich |
| GET | `/v1/me` · PATCH `/v1/me` | angemeldet |
| GET | `/v1/users/:id` | öffentlich (nur öffentliche Profildaten) |
| GET | `/v1/categories` | öffentlich |
| GET | `/v1/geo/states` · `/v1/geo/locations?q=` | öffentlich |
| GET | `/v1/listings` (Suche) · `/v1/listings/:id` | öffentlich (nur aktive; eigene auch als Entwurf) |
| GET | `/v1/listings/mine` | angemeldet |
| POST | `/v1/listings` · PATCH `/v1/listings/:id` | angemeldet, Schreib-Limit |
| POST | `/v1/listings/:id/publish` · `/pause` · `/resume` | angemeldet, nur eigene |
| DELETE | `/v1/listings/:id` | angemeldet, nur eigene (Soft-Delete) |
| GET/POST/PUT/DELETE | `/v1/listings/:id/images…` | angemeldet, nur eigene (siehe [bilder.md](bilder.md)) |
| GET | `/v1/images/:imageId/:variante` | öffentlich für aktive Inserate, sonst nur mit Signatur |

Vollständige Schemas: `http://localhost:4000/docs` (Swagger UI).

## Web-Seiten (Phase 1)

`/` Startseite · `/suche` · `/anzeige/[id]` · `/inserieren` · `/anzeige/[id]/bearbeiten` · `/anzeige/[id]/bilder` · `/registrieren` · `/anmelden` · `/passwort-vergessen` · `/passwort-neu` · `/auth/confirm` · `/konto` · `/konto/anzeigen` · `/impressum` · `/datenschutz` · `/agb` · `/melden`

## Phasenplan

1. **Fundament** (dieser Stand): Monorepo, Docker, Datenmodell, Auth, Inserate ohne Bilder, Basis-Suche, Tests, CI.
2. Bild-Upload (R2) – umgesetzt. Offen: kategorieabhängige Felder, Meilisearch, Umkreissuche, Favoriten, gespeicherte Suchen.
3. Nachrichten zwischen Nutzern, Meldungen, Moderation, Admin-Bereich, Kontolöschung (DSGVO), E-Mail-Benachrichtigungen über BullMQ.
4. Bezahlte Zusatzleistungen mit Stripe (Hervorheben, Hochschieben), Rechnungen, Händlerkonten.
5. Vertikalen ausbauen: Auto & Motor (Fahrzeugdaten), Immobilien (Fläche, Zimmer, HWB), Jobs (Firmenprofile, Bewerbungen).
6. Optionale KI-Funktionen, Performance, Monitoring, Produktionsbetrieb.
