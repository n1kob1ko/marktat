# Partnerangebote über Affiliate-Netzwerke (Awin)

> Stand 28.10.2026: Technisch fertig und mit einem lokalen Awin-Testserver getestet. **Der Liveimport ist aus**
> (`AWIN_ENABLED=false`). Es gibt noch kein Awin-Publisher-Konto, keine Partnerschaften und keine Schlüssel; es wurde
> nichts Echtes importiert. Einschalten erst, wenn Niko Konto, Partnerschaften und Schlüssel hat.

MarktAT nimmt bei Awin als **Publisher** teil (Werbepartner, kostenlos; Awin verlangt bei der Anmeldung 1 € Kaution, die
mit der ersten Provision zurückkommt). Der kostenpflichtige Advertiser-Tarif (für Shops, die selbst Werbepartner suchen)
wird **nicht** gebraucht.

## Drei getrennte Arten von Deals

| Herkunft (`deals.source`) | Wer liefert | Händler im Deal | Freigabe |
| --- | --- | --- | --- |
| `MANUAL`, `CSV` | Händler mit MarktAT-Konto, im Formular oder per CSV-Datei | `merchant_id` = dieses Konto | Kontoregeln aus [deals.md](deals.md) |
| `FEED` | eigener Produktfeed des Händlers (`deal_feeds`) | `merchant_id` = dieses Konto | Team gibt den Feed frei |
| `AFFILIATE` | zentral über ein Netzwerk (jetzt Awin) | **kein** MarktAT-Konto: `merchant_id` ist leer, `affiliate_program_id` verweist auf das Programm | Admin gibt das Programm frei, Awin meldet die Partnerschaft als aktiv, Admin aktiviert den Feed |

Die Datenbank erzwingt die Trennung (`deals_owner_check`): Ein Affiliate-Deal hat nie ein Händlerkonto, ein
Händler-Deal nie ein Programm. Affiliate-Deals lassen sich keinem Händlerkonto zuordnen (API antwortet 409). So wird
kein fremdes Angebot einem MarktAT-Konto zugeschrieben, das den Händler nicht vertritt.

## Ablauf

```
Awin ──(stündlich, mit Zufallsverzögerung)── Feedliste ─► Programme + Feeds anlegen/aktualisieren (Status „wartet“)
                                                        │
Admin: Programm freigeben (Doku Pflicht, 2FA) ─► Feed aktivieren
                                                        │
Feed hat laut „Last Imported“ einen neuen Stand? ─ja─► Download (gzip/CSV, gestreamt) ─► Deals anlegen/aktualisieren
                                                   └nein─► nichts laden
Awin ──(alle 4 Stunden)── Promotions-API ─► Aktionen & Gutscheine freigegebener Programme
```

- Läuft über die vorhandene Warteschlange (BullMQ): Aufgaben `affiliate-sync` (60 min), `affiliate-promotions`
  (4 h), `affiliate-manual` (Knopf im Admin-Bereich). Code: `apps/api/src/affiliate/`.
- **Änderungszeitpunkt statt Volldownload**: Ein Feed wird nur geladen, wenn „Last Imported“ in der Feedliste neuer ist
  als der zuletzt übernommene Stand, und frühestens alle 3 Stunden. Höchstens 3 Feeds je Lauf.
- **API-Limits**: höchstens 18 Aufrufe/Minute (Awin erlaubt 20), bei 429 und 5xx zwei Wiederholungen nach 15 s und
  60 s. Fehlerhafte Feeds werden mit wachsendem Abstand erneut versucht und nach 5 Fehlern in Folge als „Fehlerhaft“
  angehalten (Eintrag im Protokoll und in der Fehlerübersicht).
- **Stabile IDs**: `merchant_product_id`, sonst `id`, sonst `aw_product_id` je Programm (`@@unique(affiliateProgramId,
  externalId)`). Wiederholte Abrufe aktualisieren, statt zu verdoppeln; Preisänderungen landen in der Preisgeschichte.
- **Gültigkeit**: `valid_from`/`valid_to` aus dem Feed. Ohne Enddatum gilt ein Angebot 7 Tage und verlängert sich bei
  jedem Abruf, in dem es noch vorkommt. Fehlt es im Feed oder ist es nicht lieferbar, wird es beendet und
  ausgeblendet; taucht es wieder auf, wird es wieder aktiv. Gelöschte oder abgelehnte Angebote bleiben weg.
- **Pausieren** eines Programms, eines Feeds oder verlorene Partnerschaft blendet sofort alles aus (Sichtbarkeit wird
  bei jeder Anfrage geprüft, nicht erst beim nächsten Abruf).

## Datenregeln

- **Rabatt nur belegt**: nur aus dem Vergleichspreis des Feeds (`rrp_price`, „UVP“) und nur, wenn das Programm das laut
  Bedingungen erlaubt (Häkchen bei der Freigabe). `savings_percent` und `product_price_old` werden nie übernommen.
  Rabatte ab 70 % gehen in die Prüfung, bevor sie sichtbar werden.
- **Preise**: ohne gültigen Preis in Euro wird ein Produkt übersprungen (Zähler „Ungültige Preise“).
- **Bilder** nur mit Häkchen „Produktbilder erlaubt“ und **unverändert** (Awin-Bedingungen, Punkt 10.1): Die API reicht
  das Originalbild durch (`/v1/deals/<id>/partner-image/large`, Zwischenspeicher 6 h) und verändert, skaliert oder
  speichert es nicht dauerhaft. Besucher:innen laden so nichts direkt vom Händler. Ohne Erlaubnis kein Bild.
- **Links**: nur der https-Tracking-Link von Awin (`aw_deep_link`), höchstens 1000 Zeichen, über
  `/deals/<id>/zum-angebot`. Die regelmäßige Linkprüfung lässt Affiliate-Links aus (sie würde Klicks vortäuschen).
- **Kennzeichnung**: „Werbung“ auf Karte und Detailseite, „Partnerangebot über Awin“, Händlername, „Quelle:
  Produktfeed von … über Awin“, Datenstand des Feeds, Provisionshinweis beim Knopf, Erklärseite `/deals/werbung`,
  Abschnitt in der Datenschutzerklärung.
- **Gutscheincodes** nur mit Häkchen „Gutscheincodes erlaubt“; sonst erscheint die Aktion ohne Code.
- Keine Zugangsdaten in der Datenbank: Feed-Adressen (sie enthalten den Schlüssel) werden nie gespeichert, Fehlertexte
  werden von Schlüsseln und Tokens bereinigt, die Admin-Seite zeigt nur, *welche* Einstellungen fehlen.

## Einstellungen (`/opt/marktat/.env`, nie ins Repository)

| Variable | Wert |
| --- | --- |
| `AWIN_ENABLED` | `false` bis alles da ist, dann `true` |
| `AWIN_PUBLISHER_ID` | Publisher-ID (Zahl, im Awin-Konto oben links neben dem Kontonamen) |
| `AWIN_API_TOKEN` | Benutzermenü → **API Credentials** → Passwort → **Show my API token** |
| `AWIN_FEED_API_KEY` | **Toolbox → Create-a-Feed**: in der angezeigten Download-Adresse der Teil nach `apikey/` (anderer Schlüssel als das API-Token) |
| `AWIN_REGION` | `AT` |
| `AWIN_MAX_PRODUCTS_PER_FEED` | `5000` (Schutz für Speicher und Suche; mehr nur bei Bedarf) |

Die Startprüfung (`pnpm env:check`, läuft bei jedem Deployment) verlangt bei `AWIN_ENABLED=true` alle drei Schlüssel
und die offiziellen Awin-Adressen.

## Freigaben, die es braucht

1. **Publisher-Konto** bei Awin (Österreich/DACH), mit MarktAT als Website (die Website muss dafür online sein, Awin
   prüft sie). Angaben zu Unternehmen und Auszahlung macht Niko selbst.
2. **Partnerschaft je Händler**: im Awin-Konto im Bereich *Advertisers* (Programm suchen, „Join“) bei jedem gewünschten Programm
   bewerben. Der Händler entscheidet. Erst „Joined“ zählt; MarktAT liest das aus der Feedliste.
3. **Programmbedingungen lesen** (je Programm): Sind Produktbilder, Vergleichspreise (UVP), Gutscheincodes und das
   Werbeumfeld „Kleinanzeigen-/Preisvergleichsplattform“ erlaubt? Das Ergebnis kommt in die Dokumentation der
   Freigabe und in die Häkchen.
4. **Produktfeed**: Manche Händler geben ihren Feed erst auf Anfrage frei (*Toolbox → Create-a-Feed* zeigt nur
   freigeschaltete Feeds).
5. **Freigabe in MarktAT**: Admin-Bereich → **Affiliate** → Programm → „Freigabe bearbeiten“ (mindestens 20 Zeichen
   Dokumentation, mit 2FA-Code) → Feed „Aktivieren“.

## Admin-Bereich (`/admin/affiliate`)

Moderation sieht alles, ändern darf nur die Administration.

- Verbindung: Liveimport an/aus, fehlende Einstellungen (nur Namen), automatischer Abruf, letzter erfolgreicher Abruf
- Warnungen: Import aus, fehlende Schlüssel, fehlerhafte Feeds, freigegeben aber Partnerschaft weg, freigegeben ohne
  aktiven Feed, seit über 3 Stunden kein erfolgreicher Abruf, ungültige Preise
- Kennzahlen: aktive Partnerangebote, verbundene Händler, fehlerhafte Feeds, abgelaufene/nicht lieferbare Angebote,
  Angebote ohne erlaubtes Bild, ungültige Preise, in Prüfung, Aktionen & Gutscheine
- Programme mit Feeds, Freigabe/Anhalten/Ablehnen, Feeds aktivieren/anhalten, „Jetzt abrufen“ und „Feed jetzt abrufen“
- Letzte Abrufe mit Ergebnis (neu, aktualisiert, beendet, übersprungen mit Grund)

Alle Freigaben, Pausen und manuellen Abrufe stehen im Protokoll (`admin.affiliate_*`).

## Weitere Netzwerke

`affiliate_programs.network` ist eine Aufzählung (`AWIN`). Ein weiteres Netzwerk braucht einen eigenen Client und eine
eigene Zuordnung der Feedspalten; Freigaben, Sichtbarkeit, Kennzeichnung und Admin-Seite bleiben gleich.

## Tests

- API: `apps/api/test/affiliate.e2e-spec.ts` (14 Tests) gegen einen lokalen Awin-Testserver: Zuordnung, aus ohne
  Schlüssel, nur Freigegebenes, Freigaberegeln mit 2FA, Import mit Kennzeichnung und Bild, Bildverbot,
  Änderungserkennung und Preisupdate, Ende und Reaktivierung, Pause und verlorene Partnerschaft, Wiederholungen und
  angehaltene Feeds ohne Schlüssel im Fehlertext, strikte Trennung, Meldungen und Moderation, Höchstzahl, Aktionen und
  Gutscheine, manueller Abruf.
- Browser: `apps/web/e2e/affiliate.spec.ts`. Der volle Ablauf braucht den Testserver aus `e2e/fake-awin.ts` und eine
  API mit dessen Werten:
  ```bash
  AWIN_ENABLED=true AWIN_PUBLISHER_ID=123456 AWIN_API_TOKEN=e2e-api-token-0123456789 \
  AWIN_FEED_API_KEY=e2e-feed-key-0123456789 AWIN_API_URL=http://127.0.0.1:4599 \
  AWIN_PRODUCTDATA_URL=http://127.0.0.1:4599 OUTBOUND_ALLOW_PRIVATE=true node apps/api/dist/main.js
  E2E_AWIN_FAKE_PORT=4599 pnpm --filter @marktat/web exec playwright test affiliate
  ```
  Ohne `E2E_AWIN_FAKE_PORT` (Generalprobe, online) prüft der Test nur die Admin-Seite im ausgeschalteten Zustand und
  die Kennzeichnungsseite.
  Die CI startet die API genau so und führt den vollen Ablauf bei jedem Pull Request aus.
