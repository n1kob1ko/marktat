# Deals & Angebote

Phase 10, Schritt 1. Händler stellen eigene Angebote ein, online, im Geschäft oder beides. MarktAT verkauft nichts selbst. Es gibt keinen Warenkorb und keine Zahlung, nur einen gekennzeichneten Link zum Händler.

Es gibt drei streng getrennte Herkünfte: Händler-Deals (Formular, CSV), eigene Produktfeeds der Händler und zentrale
Partnerangebote über Affiliate-Netzwerke (`source = AFFILIATE`, ohne Händlerkonto, siehe [affiliate.md](affiliate.md)).

## Datenmodell

Deals sind **keine Inserate**. Preis-, Händler-, Link- und Ablaufregeln unterscheiden sich zu stark.

| Tabelle | Zweck |
| --- | --- |
| `deal_categories` | 15 Deal-Kategorien (Seed). `related_category_path` verweist auf die passende Marktplatz-Kategorie, damit es keine doppelte Kategorielogik gibt: Die Detailseite verlinkt „Gebraucht im Marktplatz“. |
| `deals` | Ein Angebot: Preis, optionaler Vergleichspreis mit Art, Quelle, Beleg und Bestätigung, berechneter Rabatt, Zeitraum, Kanal, Link, Bildrechte, Herkunft (`MANUAL`/`CSV`/`FEED`), `external_id` je Händler (eindeutig, für wiederholte Importe), Linkprüfung, Zähler |
| `dealer_stores` | Filialen eines Händlers (Adresse, PLZ-Ort aus der Geodatenbank) |
| `deal_stores` | In welchen Filialen ein Deal gilt |
| `deal_price_records` | Preise, die MarktAT **selbst** bei jeder Preisänderung erfasst. Grundlage für „niedrigster erfasster Preis 30 Tage“, nie geschätzt. |
| `deal_imports` | Jeder CSV-Import und jeder Feed-Abruf: Datei bzw. Feed, Status, Spaltenzuordnung, Ergebnis je Zeile mit Änderungen und Fehlern, Zähler. Die Rohdaten liegen nur bis zur Übernahme bzw. höchstens 24 Stunden in der Vorschau. |
| `deal_feeds` | Produktfeeds der Händler: Adresse, Format, Abrufabstand, Herkunft und Nutzungsrechte laut Händler, Freigabe durch das Team, letzter Abruf, Fehlerzähler, ETag |

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
  - Eine Preisänderung an einem freigegebenen Deal löst die Prüfung erneut aus, auch während einer Pause. Sonstige Änderungen tun das nicht.
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
| `deal-link-check` | 30 min (Standard; mit `DEAL_LINK_CHECK=false` abschaltbar) | prüft jeden Link höchstens einmal täglich, siehe unten |
| `deal-feed-sync` | 15 min (Standard; mit `DEAL_FEED_SYNC=false` abschaltbar) | ruft fällige, **freigegebene** Feeds ab, höchstens 5 je Durchlauf, siehe „Produktfeeds“ |
| `deal-import-cleanup` | 1 h | beendet abgelaufene Vorschauen und löscht deren Rohdaten |

So arbeitet `deal-link-check`:

- Die Prüfung schickt HEAD, bei 405 oder 501 einen kleinen GET, und läuft über `safeFetch` (keine internen Adressen, höchstens 5 Weiterleitungen).
- Nur 404 und 410 zählen als Fehler. Nach **3** solchen Fehlern in Folge ist der Link `BROKEN` und der Deal ausgeblendet.
- 403, 429, 5xx und Zeitüberschreitungen ändern nichts.

Der Suchindex `${MEILI_INDEX}_deals` wird nach jeder Änderung aktualisiert. Fällt Meilisearch aus, sucht die API direkt in Postgres und PostGIS mit denselben Filtern.

## Importe per CSV-Datei

Händlerbereich: `/konto/deals/import`. API: `/v1/me/deal-imports`.

1. **Vorlage** (`/api/deals/importe/vorlage`): Kopfzeile mit den Spalten aus `DEAL_IMPORT_FIELDS` (`packages/shared/src/deals/import.ts`). Die Seite erklärt jede Spalte mit Beispiel.
2. **Hochladen** (`POST /v1/me/deal-imports`, Rohdaten `text/csv`): höchstens 2 MB, 1000 Zeilen, 30 Importe je 24 Stunden. Trennzeichen Semikolon, Komma oder Tabulator (automatisch erkannt), Anführungszeichen nach RFC 4180, UTF-8 oder Windows-1252 (Excel).
3. **Spalten zuordnen**: Vorlagennamen und übliche Aliase (z. B. `sku`, `uvp`, `ean`) werden automatisch zugeordnet; die Zuordnung lässt sich je Feld ändern (`PUT …/:id/mapping`).
4. **Vorschau**: Jede Zeile wird mit denselben Regeln wie das Formular geprüft. Ergebnis je Zeile: `Neu`, `Aktualisieren` (mit Liste der geänderten Felder), `Unverändert`, `Übersprungen` oder `Fehler` mit Meldung. Gespeichert wird noch nichts.
5. **Übernehmen** (`POST …/:id/commit`): neue Angebote veröffentlichen oder als Entwurf speichern. Fehlerhafte Zeilen werden übersprungen, jede Zeile läuft in einer eigenen Transaktion.
6. **Ergebnis und Historie**: Ergebnis je Zeile, Fehlerliste als CSV (`/api/deals/importe/:id/fehler`), die letzten 50 Importe.

Regeln:

- **Stabile Kennung**: Ein Angebot wird über `(Händler, Artikelnummer)` erkannt. Ein erneuter Import aktualisiert statt doppelt anzulegen. Doppelte Artikelnummern in derselben Datei sind ein Fehler; ein neues Angebot mit dem Titel eines bestehenden bekommt den Hinweis „Mögliches Doppel“. Ein gelöschtes Angebot gibt seine Artikelnummer frei.
- **Vergleichspreise**: Enthält die Datei Vergleichspreise, muss der Händler sie beim Übernehmen ausdrücklich bestätigen; sonst werden diese Zeilen nicht übernommen. Erlaubt sind nur `uvp` (mit Quelle) und `30_tage` (eigener niedrigster Preis der letzten 30 Tage vor der Ermäßigung). Den Rabatt berechnet die API.
- **Bestehende Angebote** behalten ihren Status. Es gelten dieselben Prüfregeln wie beim Bearbeiten (hoher Rabatt → Prüfung). Vom Team abgelehnte oder ausgeblendete Angebote werden übersprungen. Ohne Spalte „beginn“ bleibt der bisherige Beginn.
- **Nachvollziehbarkeit**: Jedes Angebot merkt sich den letzten Import (`last_import_id`) und die Herkunft (`source`). Der Import speichert die Änderungen je Zeile. Preisänderungen landen in `deal_price_records`. Das Audit-Log enthält `deal.import_uploaded` und `deal.import_committed` mit den Zählern.
- Ein Import gilt als Bestätigung („Zuletzt geprüft“) der enthaltenen, laufenden Angebote, auch der unveränderten.
- Doppelte Übernahme (Doppelklick) ist ausgeschlossen: Der Status wechselt atomar von `PREVIEW` auf `COMMITTED`.
- **Bilder** werden weder aus Dateien noch aus Feeds übernommen. Der Händler lädt sie selbst hoch und gibt die Herkunft an (siehe „Bilder“).
- **CSV-Injection**: Alle CSV-Downloads entschärfen Zellen, die mit `=`, `+`, `-`, `@`, Tabulator oder Wagenrücklauf beginnen (vorangestelltes `'`).

## Produktfeeds (Partner-Schnittstelle)

Händlerbereich: `/konto/deals/feeds`. Moderation: `/admin/deals/feeds`. API: `/v1/me/deal-feeds`, `/v1/admin/deal-feeds`.

Ein Feed ist der **eigene** Produktfeed eines Händlers (oder der seines Feed-Dienstleisters). MarktAT liest **keine** fremden Plattformen aus (kein Scraping von Geizhals, idealo, marktguru o. ä.) und behauptet keine Partnerschaften. Es gibt derzeit keine Vereinbarung mit einem Preisvergleichs- oder Prospektanbieter.

Ablauf:

1. Händler hinterlegt Name, https-Adresse, Format (CSV mit den Spalten der Vorlage oder JSON-Liste), Abrufabstand (6 bis 168 Stunden) und beschreibt **Herkunft und Nutzungsrechte**. Er bestätigt, dass er die Daten so verwenden darf. Vergleichspreise aus dem Feed werden nur übernommen, wenn er sie gesondert bestätigt.
2. **Probeabruf** (auch vor der Freigabe): ein Abruf mit Vorschau je Zeile, nichts wird übernommen. Dort lässt sich auch die Spaltenzuordnung für den Feed speichern.
3. **Freigabe** durch Moderation oder Administration (nicht die eigene). Erst dann wird regelmäßig abgerufen. Eine neue Adresse oder ein anderes Format braucht eine neue Freigabe.
4. **Abruf** (`deal-feed-sync`): über `safeFetch` (keine internen Adressen, höchstens 3 Weiterleitungen, 20 s, 5 MB), mit eigenem User-Agent und bedingter Anfrage (`If-None-Match`/`If-Modified-Since`).
   - `304`: nichts geändert; die laufenden Angebote des Feeds gelten als bestätigt.
   - `429`: Hinweis auf Abrufbegrenzung, nächster Versuch zum nächsten Termin.
   - Sonst dieselbe Prüfung wie beim CSV-Import, neue Angebote werden veröffentlicht. Angebote des Feeds, die nicht mehr enthalten sind, werden **beendet** (`EXPIRED`). Angebote, die gerade geprüft werden (hoher Rabatt oder vom Team ausgeblendet), bleiben in Prüfung und enden nur zeitlich; sonst ließe sich eine Entscheidung durch Entfernen und Verlängern umgehen.
5. **Fehler** werden am Feed (`last_error`, Zähler) und als fehlgeschlagener Import festgehalten. Nach **5** Fehlschlägen in Folge wird der Feed angehalten (`FAILING`, Audit `deal.feed_failing`). Der Händler kann ihn nach der Behebung fortsetzen. Einen **vom Team** angehaltenen Feed setzt erst eine neue Freigabe fort.

Ein angehaltener, pausierter oder entfernter Feed aktualisiert nichts mehr. Seine Angebote verlieren nach 14 Tagen ohne Bestätigung automatisch die Sichtbarkeit.

Was für echte Partner-Schnittstellen fehlt:

- Verträge bzw. Lizenzen mit Händlern, Feed-Dienstleistern oder Preisvergleichsdiensten, inklusive Bildrechten. MarktAT hat derzeit keine.
- Eine Händler- bzw. Produkt-ID über Händlergrenzen hinweg (heute: Artikelnummer je Händler, optional GTIN).
- Anbieterbezogene Abrufgrenzen und Zugangsdaten (API-Schlüssel, OAuth). Heute gibt es nur öffentliche Feed-Adressen ohne Anmeldung.
- Ein Format für Verfügbarkeit je Filiale.

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

Affiliate-Links markiert der Händler selbst. Sie erscheinen als „Werbelink“. Zentrale Partnerangebote (Awin) sind
dagegen als „Werbung“ gekennzeichnet und führen auf den Tracking-Link des Netzwerks ([affiliate.md](affiliate.md)).

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
- Alle Schritte stehen im Audit-Log, z. B. `deal.created`, `deal.published`, `deal.reported`, `moderation.deal_rejected`, `admin.deals_blocked`, `admin.deal_merchant_changed`, `admin.deal_feed_approve`.
- Produktfeeds prüft das Team unter `/admin/deals/feeds`, fehlgeschlagene Importe und Importe mit Fehlerzeilen der letzten 30 Tage stehen unter `/admin/deals/importe`.

## Startseite

Der Abschnitt „Aktuelle Deals & Angebote“ zeigt höchstens 4 öffentlich sichtbare Deals, die neuesten zuerst, und steht **unter** „Neu eingestellt“.

- Ohne Deals erscheint eine Einladung an Händler statt Beispielprodukten.
- Eine regionale Auswahl gibt es noch nicht. Die Startseite kennt keinen Standort der Besucher:innen, und eine Standortabfrage beim Laden wäre aufdringlich.

## Merkliste und gespeicherte Suchen

Deals lassen sich merken und als Suche speichern, mit höchstens einer Sammel-E-Mail am Tag. Details stehen in [nachrichten.md](nachrichten.md#deals-und-anbieterprofile-phase-10).

## Tests

- `apps/api/test/deals.e2e-spec.ts` deckt ab:
  - Berechtigung, Fremdzugriff, Preisregeln, Prüfung ab 70 %, niedrigster 30-Tage-Preis
  - Filter mit Meilisearch und mit Postgres-Ausweichsuche
  - Sichtbarkeitsregeln, Ablauf und Verlängerung
  - Linkprüfung mit lokalem Server, Klicks, Bildrechte
  - Melden, Ablehnen, Einspruch
  - Admin-Rechte, Doppelte, Deal-Sperre
- `apps/api/test/deal-imports.e2e-spec.ts` deckt ab:
  - Vorschau mit Fehlern je Zeile, Bestätigung der Vergleichspreise, Doppelklick-Schutz
  - Aktualisierung über die Artikelnummer, Änderungsliste, Preisaufzeichnung, Beginn bleibt erhalten
  - abgelehnte Deals überspringen, Entwurf ohne Berechtigung, Privatkonten ausgeschlossen
  - Spaltenzuordnung, Windows-1252, Fremdzugriff (404)
  - leere, kaputte und zu große Dateien, Ablauf der Vorschau
  - Feeds mit lokalem Server: Abruf erst nach Freigabe, Intervall, 304, fehlende Angebote beenden, Abschaltung nach 5 Fehlern, Vergleichspreise nur mit Bestätigung
  - Importfehler in der Moderation, CSV ohne Formeln
- `apps/web/e2e/deal-imports.spec.ts` (Desktop und Mobil): Vorlage, Upload, Vorschau, Bestätigung, Übernahme, erneuter Import, Fehlerliste, Feed einreichen, Freigabe durch die Moderation, Importfehler im Admin-Bereich, Aufräumen.
- `apps/web/e2e/deals.spec.ts` (Desktop und Mobil) spielt einen Ablauf durch:
  - Händler bestätigt seine Angaben, legt eine Filiale an und veröffentlicht einen Deal mit UVP
  - der Deal ist in der Suche und der Umkreissuche auffindbar
  - Detailseite und Weiterleitung funktionieren
  - Pausieren und Löschen funktionieren
