# Datenmodell

Quelle der Wahrheit ist `apps/api/prisma/schema.prisma`, die erste Migration liegt unter
`apps/api/prisma/migrations/20261026000000_init`. Tabellen und Spalten sind `snake_case`, IDs von Inseraten und
Kategorien sind CUIDs (nicht erratbar), Nutzer-IDs die UUID aus Supabase Auth.

## Tabellen (umgesetzt)

| Tabelle | Zweck | Wichtige Felder |
| --- | --- | --- |
| `users` | Profil zu einem Supabase-Konto | `id` (= `auth.users.id`), `email`, `display_name`, `account_type` (PRIVATE/BUSINESS), `role`, `status`, Firmenangaben (`company_name`, `company_register_number`, `vat_id`, `company_address`), `terms_version`, `terms_accepted_at`, `deleted_at`, `notify_messages_by_email`, `notify_searches_by_email` |
| `states` | 9 Bundesländer | `id` 1–9, `code` (AT-1 … AT-9), `slug`, `name` |
| `districts` | 93 politische Bezirke + 23 Wiener Gemeindebezirke | `id` = Bezirkskennziffer (Statistik Austria), `state_id` |
| `locations` | Orte mit PLZ (vollständiges Verzeichnis, ~20.900 Orte) | `postal_code`, `place`, `municipality` (Gemeinde, wenn anders als der Ort), `district_id`, `latitude`, `longitude`, `geom geography(Point,4326)` mit GiST-Index, Trigramm-Index auf `place` |
| `categories` | Kategoriebaum je Bereich | `parent_id`, `vertical`, `path` (eindeutig, für SEO-URLs; bestimmt auch die Zusatzfelder), `attribute_schema` (JSON, derzeit ungenutzt) |
| `listings` | Inserate | `seller_id`, `category_id`, `vertical`, `title`, `description`, `price_type`, `price_cents` (BIGINT), `condition`, `attributes` (JSON, kategorieabhängige Zusatzangaben, siehe [Kategorie-Felder](kategorie-felder.md)), `status`, `location_id`, `published_at`, `expires_at`, `deleted_at` |
| `listing_images` | Bilder je Inserat (Phase 2) | `status` (PENDING/READY), `upload_key` (Rohdatei, nach Verarbeitung leer), `storage_key` (Präfix der Varianten), `declared_type`/`declared_size`, `detected_type`, `width`, `height`, `stored_bytes`, `sort_order` (0 = Hauptbild) |
| `favorites` | Merkliste (Phase 5) | Primärschlüssel `(user_id, listing_id)` – keine Duplikate; Cascade beim Löschen von Konto oder Inserat |
| `saved_searches` | Gespeicherte Suchen (Phase 5) | `name`, `params` (JSON, kanonische Such-Parameter), `query_key` (Unique je Konto), `labels`, `notify`, `last_checked_at`, `last_notified_at` |
| `conversations` | Unterhaltung zu einem Inserat (Phase 5) | `listing_id` (Restrict), `buyer_id`, `seller_id`, `last_message_at`; Unique `(listing_id, buyer_id)`, CHECK `buyer_id <> seller_id` |
| `messages` | Nachrichten (Phase 5) | `conversation_id`, `sender_id`, `recipient_id`, `body` (max. 2.000 Zeichen, CHECK nicht leer), `read_at`, `notified_at` (E-Mail verschickt) |
| `user_blocks` | Blockierungen (Phase 5) | Primärschlüssel `(blocker_id, blocked_id)`, CHECK keine Selbstblockade |
| `user_reports` | Meldungen von Personen (Phase 5) | `reporter_id`, `reported_id`, `conversation_id`, `reason` (SPAM/FRAUD/HARASSMENT/OTHER), `details`, `status` (OPEN/RESOLVED/DISMISSED) |
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
| später | `moderation_actions`, Meldungen zu Inseraten | Meldeverfahren nach DSA (Art. 16/17: Begründung an Betroffene); Personen-Meldungen gibt es seit Phase 5 (`user_reports`) |
| später | `notifications` | In-App-Benachrichtigungen; E-Mails laufen seit Phase 5 über BullMQ |
| 4 | `products`, `orders`, `payments`, `invoices`, `listing_promotions` | Stripe Checkout/Webhooks, Beträge in Cent |
| 5 | `vehicle_details`, `property_details`, `job_details`, `companies`, `job_applications` | 1:1 zu `listings` für typisierte, filterbare Felder |
| 6 | `ai_jobs` | optionale KI-Vorschläge, protokolliert und abschaltbar |

## Seeds

- `pnpm db:seed` – Stammdaten: Bundesländer, Bezirke, vollständiges PLZ-Verzeichnis (~20.900 Orte), 84 Kategorien. Idempotent.
- `pnpm db:seed -- --demo` – zusätzlich 15 Demo-Inserate eines Demo-Verkäufers. Jede Beschreibung endet mit „[Testdaten – nur für die Entwicklung]“, der Verkäufer heißt „Demo-Verkäufer (Testdaten)“; mit `NODE_ENV=production` verweigert das Skript den Lauf.
- `pnpm --filter @marktat/api geo:build` / `geo:import --file AT.txt` – PLZ-Verzeichnis aus einem neueren GeoNames-Download, siehe [geodaten.md](geodaten.md).
- `pnpm --filter @marktat/api search:reindex` – Suchindex neu aufbauen, siehe [suche.md](suche.md).

## Migrationen

Phase 5 (`20261027093422_user_interactions`) legt nur neue Tabellen, Enums und zwei Spalten mit Standardwert an – bestehende Daten bleiben unverändert. Die CHECK-Constraints stehen am Ende der Migration.

- Lokal neue Migration anlegen: `pnpm --filter @marktat/api db:migrate:dev --name beschreibung`
- Anwenden (CI, Produktion): `pnpm db:migrate` (`prisma migrate deploy`)
