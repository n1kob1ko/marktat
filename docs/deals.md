# Deals & Angebote

Phase 10, Schritt 1. Händler stellen eigene Angebote ein, online, im Geschäft oder beides. MarktAT verkauft nichts selbst. Es gibt keinen Warenkorb und keine Zahlung, nur einen gekennzeichneten Link zum Händler.

## Datenmodell

Deals sind **keine Inserate**. Preis-, Händler-, Link- und Ablaufregeln unterscheiden sich zu stark.

| Tabelle | Zweck |
| --- | --- |
| `deal_categories` | 15 Deal-Kategorien (Seed). `related_category_path` verweist auf die passende Marktplatz-Kategorie, damit es keine doppelte Kategorielogik gibt: Die Detailseite verlinkt „Gebraucht im Marktplatz“. |
| `deals` | Ein Angebot: Preis, optionaler Vergleichspreis mit Art, Quelle, Beleg und Bestätigung, berechneter Rabatt, Zeitraum, Kanal, Link, Bildrechte, Herkunft (`MANUAL`/`CSV`/`FEED`), `external_id` je Händler (eindeutig, für wiederholte Importe), Linkprüfung, Zähler |
| `dealer_stores` | Filialen eines Händlers (Adresse, PLZ-Ort aus der Geodatenbank) |
| `deal_stores` | In welchen Filialen ein Deal gilt |
| `deal_price_records` | Preise, die MarktAT **selbst** bei jeder Preisänderung erfasst. Grundlage für „niedrigster erfasster Preis 30 Tage“, nie geschätzt. |

Neue Spalten in `users`: `dealer_certified_at` (Bestätigung nach Art. 30 DSA) und `deals_blocked_at` (Deal-Sperre durch die Moderation).

Die Migrationen fügen nur Tabellen, Spalten und Enum-Werte hinzu. Bestehende Daten bleiben unverändert.

## Wer darf Deals veröffentlichen?

Alle Voraussetzungen müssen erfüllt sein, die API prüft das bei jedem Veröffentlichen:

- gewerbliches, aktives Konto
- Firmenname, Geschäftsanschrift und Telefonnummer im Profil
- einmalige Bestätigung unter `/konto/deals` (Angaben stimmen, gewerblich, nur eigene Angebote, Preise belegbar)
- keine Deal-Sperre

Entwürfe sind auch vorher möglich.

## Preise und Rabatt

- **Angebotspreis**: Pflicht, inkl. USt. Grundpreis und Versand sind optional.
- **Vergleichspreis**: nur mit Grundlage. Ohne Grundlage gibt es keinen Rabatt.
  - „Niedrigster Preis der letzten 30 Tage vor der Ermäßigung“ (§ 9a PrAG, Art. 6a Preisangaben-RL)
  - „UVP“, nur mit Quellenangabe
  - Pflicht ist die Bestätigung „stimmt und ist auf Nachfrage belegbar“. Ein Beleg-Link ist optional.
  - „Marktvergleich“ ist nur für das Team vorgesehen und für Händler gesperrt (Vorbereitung eines späteren Preisvergleichs).
- **Rabatt**: berechnet ausschließlich die API (abgerundet). Händler geben ihn nie selbst ein.
- **Prüfung vor dem Erscheinen**:
  - Ab 70 % Rabatt prüft das Team das Angebot, bevor es erscheint.
  - Eine Preisänderung an einem freigegebenen Deal löst die Prüfung erneut aus. Sonstige Änderungen tun das nicht.
- **Was es bewusst nicht gibt**:
  - keine Countdown-Timer
  - keine erfundenen Preisverläufe
  - „Endet bald“ erscheint nur als ruhiger Hinweis in den letzten 48 Stunden

## Sichtbarkeit

Ein Deal ist öffentlich, wenn **alle** Bedingungen gelten:

- Status `ACTIVE`, Beginn erreicht, Ende nicht erreicht
- in den letzten **14 Tagen** bestätigt
  - Bestätigen geht über „Gilt weiterhin“, Bearbeiten, Verlängern oder einen Import.
  - Danach steht der Deal im Händlerbereich auf „Bestätigung nötig“.
- nicht „ausverkauft“, Link nicht als defekt erkannt
- Händlerkonto aktiv und nicht für Deals gesperrt

Überall steht „Zuletzt geprüft am …“.

## Hintergrundaufgaben (BullMQ)

| Job | Takt | Wirkung |
| --- | --- | --- |
| `deal-expiry` | 10 min | setzt Deals nach dem Ende auf `EXPIRED`. Unsichtbar sind sie ab Ende ohnehin sofort. |
| `deal-link-check` | 30 min, nur mit `DEAL_LINK_CHECK=true` | prüft jeden Link höchstens einmal täglich, siehe unten |

So arbeitet `deal-link-check`:

- Die Prüfung schickt HEAD, bei 405 oder 501 einen kleinen GET, und läuft über `safeFetch` (keine internen Adressen, höchstens 5 Weiterleitungen).
- Nur 404 und 410 zählen als Fehler. Nach **3** solchen Fehlern in Folge ist der Link `BROKEN` und der Deal ausgeblendet.
- 403, 429, 5xx und Zeitüberschreitungen ändern nichts.

Der Suchindex `${MEILI_INDEX}_deals` wird nach jeder Änderung aktualisiert. Fällt Meilisearch aus, sucht die API direkt in Postgres und PostGIS mit denselben Filtern.

## Suche (`/deals`, `GET /v1/deals`)

Die Parameter sind deutsch, wie bei `/suche`:

| Parameter | Wirkung |
| --- | --- |
| `q` | Suchbegriff |
| `kategorie` | Kategorie |
| `haendler` | Händler |
| `kanal=online\|lokal` | `BOTH` zählt bei beiden |
| `bundesland` | Bundesland |
| `plz` oder `ort` + `umkreis` | Umkreissuche (PostGIS, Ortsmittelpunkt der PLZ der Filiale) |
| `preis_ab`, `preis_bis` | Preisspanne |
| `rabatt_ab` | Mindestrabatt (nur berechnete Rabatte) |
| `sortierung=relevanz\|neueste\|endet_bald\|rabatt\|preis_auf\|preis_ab\|entfernung` | Sortierung. Ohne Ort fällt `entfernung` auf `relevanz` (mit Suchbegriff) bzw. `neueste` zurück. |

Gefilterte Seiten sind `noindex`.

## Weiterleitung „Zum Angebot“

`/deals/[id]/zum-angebot`:

- zählt den Klick und leitet mit 303 weiter, nur auf die **gespeicherte** und erneut geprüfte https-Adresse (kein offener Redirect)
- die Antwort hat `noindex`, robots.txt sperrt den Pfad
- Links sind `rel="sponsored nofollow noopener"`

Affiliate-Links markiert der Händler selbst. Sie erscheinen als „Werbelink“.

## Bilder

- Upload über `/api/medien/deals/[id]`. Die Route prüft die Herkunft der Anfrage und reicht an die API weiter.
- Die API verkleinert das Bild und entfernt die Metadaten.
- Pflicht ist die Angabe der Herkunft: eigenes Foto, Herstellerbild mit Nutzungserlaubnis oder lizenziertes Bild. Bei den beiden letzten ist die Quelle Pflicht und erscheint unter dem Bild.
- Bilder anderer Shops oder Preisvergleichsseiten sind ausdrücklich untersagt.
- Es gibt keine automatische Übernahme fremder Bilder.

## Moderation

- Meldungen gehen über `/melden?deal=…` (Meldegrund, Art. 16 DSA) und landen in der bestehenden Meldeliste.
- Unter `/admin/deals` stehen Filter für: in Prüfung oder gemeldet, auffälliger Rabatt ab 50 %, Link defekt, nicht mehr bestätigt, mögliche Doppelte (gleicher Händler und gleicher Titel), Status.
- Unter `/admin/deals/[id]` liegen:
  - Vergleichspreis mit Quelle und Beleg, erfasste Preise, Linkprüfung, Meldungen, Entscheidungen
  - Ablehnen, Ausblenden oder Freigeben, mit Begründung nach Art. 17 DSA und Einspruch, wie bei Inseraten
  - nur für Administratoren, mit Bestätigungscode: Zuordnen zu einem anderen gewerblichen Konto. Filialen werden dabei entfernt und lokale Deals pausiert.
- Unter `/admin/nutzer/[id]` gibt es die **Deal-Sperre** für ein Händlerkonto.
  - Sie ist eine eigene Entscheidung mit Begründung und Einspruch.
  - Sperren darf die Moderation, aufheben nur die Administration.
  - Anzeigen bleiben unberührt.
- Alle Schritte stehen im Audit-Log, z. B. `deal.created`, `deal.published`, `deal.reported`, `moderation.deal_rejected`, `admin.deals_blocked`, `admin.deal_merchant_changed`.

## Startseite

Der Abschnitt „Aktuelle Deals & Angebote“ zeigt höchstens 4 öffentlich sichtbare Deals, die neuesten zuerst, und steht **unter** „Neu eingestellt“.

- Ohne Deals erscheint eine Einladung an Händler statt Beispielprodukten.
- Eine regionale Auswahl gibt es noch nicht. Die Startseite kennt keinen Standort der Besucher:innen, und eine Standortabfrage beim Laden wäre aufdringlich.

## Tests

- `apps/api/test/deals.e2e-spec.ts` deckt ab:
  - Berechtigung, Fremdzugriff, Preisregeln, Prüfung ab 70 %, niedrigster 30-Tage-Preis
  - Filter mit Meilisearch und mit Postgres-Ausweichsuche
  - Sichtbarkeitsregeln, Ablauf und Verlängerung
  - Linkprüfung mit lokalem Server, Klicks, Bildrechte
  - Melden, Ablehnen, Einspruch
  - Admin-Rechte, Doppelte, Deal-Sperre
- `apps/web/e2e/deals.spec.ts` (Desktop und Mobil) spielt einen Ablauf durch:
  - Händler bestätigt seine Angaben, legt eine Filiale an und veröffentlicht einen Deal mit UVP
  - der Deal ist in der Suche und der Umkreissuche auffindbar
  - Detailseite und Weiterleitung funktionieren
  - Pausieren und Löschen funktionieren
