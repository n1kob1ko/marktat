# Datenmodell

Quelle der Wahrheit ist `apps/api/prisma/schema.prisma`, die erste Migration liegt unter
`apps/api/prisma/migrations/20261026000000_init`. Tabellen und Spalten sind `snake_case`, IDs von Inseraten und
Kategorien sind CUIDs (nicht erratbar), Nutzer-IDs die UUID aus Supabase Auth.

## Tabellen (Phase 1, umgesetzt)

| Tabelle | Zweck | Wichtige Felder |
| --- | --- | --- |
| `users` | Profil zu einem Supabase-Konto | `id` (= `auth.users.id`), `email`, `display_name`, `account_type` (PRIVATE/BUSINESS), `role`, `status`, Firmenangaben (`company_name`, `company_register_number`, `vat_id`, `company_address`), `terms_version`, `terms_accepted_at`, `deleted_at` |
| `states` | 9 Bundesländer | `id` 1–9, `code` (AT-1 … AT-9), `slug`, `name` |
| `districts` | 93 politische Bezirke + 23 Wiener Gemeindebezirke | `id` = Bezirkskennziffer (Statistik Austria), `state_id` |
| `locations` | Orte mit PLZ (vollständiges Verzeichnis, ~20.900 Orte) | `postal_code`, `place`, `municipality` (Gemeinde, wenn anders als der Ort), `district_id`, `latitude`, `longitude`, `geom geography(Point,4326)` mit GiST-Index, Trigramm-Index auf `place` |
| `categories` | Kategoriebaum je Bereich | `parent_id`, `vertical`, `path` (eindeutig, für SEO-URLs; bestimmt auch die Zusatzfelder), `attribute_schema` (JSON, derzeit ungenutzt) |
| `listings` | Inserate | `seller_id`, `category_id`, `vertical`, `title`, `description`, `price_type`, `price_cents` (BIGINT), `condition`, `attributes` (JSON, kategorieabhängige Zusatzangaben, siehe [Kategorie-Felder](kategorie-felder.md)), `status`, `location_id`, `published_at`, `expires_at`, `deleted_at` |
| `listing_images` | Bilder je Inserat (Phase 2) | `status` (PENDING/READY), `upload_key` (Rohdatei, nach Verarbeitung leer), `storage_key` (Präfix der Varianten), `declared_type`/`declared_size`, `detected_type`, `width`, `height`, `stored_bytes`, `sort_order` (0 = Hauptbild) |
| `audit_logs` | Sicherheitsrelevante Ereignisse | `actor_id`, `action`, `entity_type`, `entity_id`, `ip_prefix` (gekürzt), `metadata` |

Extensions: `postgis` (Umkreissuche), `pg_trgm` (unscharfe Suche als Fallback zu Meilisearch).

Indizes sind auf die Abfragen der Phase 1 ausgelegt: aktive Inserate nach Veröffentlichungsdatum, eigene Inserate nach
Status, Inserate je Kategorie, Ablaufdatum (für einen späteren Ablauf-Job).

### Status eines Inserats

| Status | Bedeutung |
| --- | --- |
| `DRAFT` | Entwurf, nur für Eigentümer sichtbar, Pflichtfelder noch unvollständig erlaubt |
| `PENDING_REVIEW` | wartet auf Moderation (ab Phase 3) |
| `ACTIVE` | öffentlich bis `expires_at` (60 Tage, Verlängerung durch erneutes Veröffentlichen) |
| `PAUSED` | vom Eigentümer pausiert |
| `EXPIRED` | abgelaufen; wird in Phase 1 aus `ACTIVE` + `expires_at < now()` berechnet |
| `REJECTED` | von der Moderation abgelehnt (ab Phase 3) |
| `DELETED` | gelöscht (Soft-Delete, Daten für Fristen und Missbrauchsfälle erhalten) |

## Geplante Erweiterungen (noch nicht umgesetzt)

| Phase | Tabellen | Notiz |
| --- | --- | --- |
| 2 | `favorites`, `saved_searches` | gespeicherte Suche mit Filter-JSON und Benachrichtigungsintervall |
| 3 | `conversations`, `messages` | Nachrichten je Inserat zwischen Käufer und Verkäufer |
| 3 | `reports`, `moderation_actions`, `user_blocks` | Meldeverfahren nach DSA (Art. 16/17: Begründung an Betroffene) |
| 3 | `notifications`, `email_events` | über BullMQ versendet |
| 4 | `products`, `orders`, `payments`, `invoices`, `listing_promotions` | Stripe Checkout/Webhooks, Beträge in Cent |
| 5 | `vehicle_details`, `property_details`, `job_details`, `companies`, `job_applications` | 1:1 zu `listings` für typisierte, filterbare Felder |
| 6 | `ai_jobs` | optionale KI-Vorschläge, protokolliert und abschaltbar |

## Seeds

- `pnpm db:seed` – Stammdaten: Bundesländer, Bezirke, vollständiges PLZ-Verzeichnis (~20.900 Orte), 84 Kategorien. Idempotent.
- `pnpm db:seed -- --demo` – zusätzlich 15 Demo-Inserate eines Demo-Verkäufers. Jede Beschreibung endet mit „[Testdaten – nur für die Entwicklung]“, der Verkäufer heißt „Demo-Verkäufer (Testdaten)“; mit `NODE_ENV=production` verweigert das Skript den Lauf.
- `pnpm --filter @marktat/api geo:build` / `geo:import --file AT.txt` – PLZ-Verzeichnis aus einem neueren GeoNames-Download, siehe [geodaten.md](geodaten.md).
- `pnpm --filter @marktat/api search:reindex` – Suchindex neu aufbauen, siehe [suche.md](suche.md).

## Migrationen

- Lokal neue Migration anlegen: `pnpm --filter @marktat/api db:migrate:dev --name beschreibung`
- Anwenden (CI, Produktion): `pnpm db:migrate` (`prisma migrate deploy`)
