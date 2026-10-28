# Merkliste, gespeicherte Suchen und Nachrichten (Phase 5)

## Überblick

| Funktion | Web | API |
| --- | --- | --- |
| Merkliste | Herz auf Karten und Detailseite, `/konto/merkliste` | `GET /v1/me/favorites`, `GET /v1/me/favorites/ids?listingIds=…`, `PUT/DELETE /v1/me/favorites/:listingId` |
| Gespeicherte Suchen | „Suche speichern“ auf `/suche`, `/konto/suchen` | `GET/POST /v1/me/searches`, `PATCH/DELETE /v1/me/searches/:id` |
| Nachrichten | Kontaktformular auf der Detailseite, `/nachrichten`, `/nachrichten/[id]` | `POST /v1/listings/:id/conversations`, `GET /v1/conversations`, `GET /v1/conversations/:id`, `GET/POST /v1/conversations/:id/messages`, `POST /v1/conversations/:id/read`, `GET /v1/me/unread` |
| Echtzeit | Zähler im Header und im Konto, Chat, Postfach | `GET /v1/me/events` (Server-Sent Events) |
| Blockieren und Melden | Menü im Chat, `/konto/benachrichtigungen` | `POST/DELETE /v1/users/:id/block`, `GET /v1/me/blocks`, `POST /v1/conversations/:id/report` |
| E-Mail-Einstellungen | `/konto/benachrichtigungen` | `PATCH /v1/me/notifications` |

## Merkliste

- Tabelle `favorites` mit Primärschlüssel `(user_id, listing_id)`: doppelte Einträge sind auf Datenbankebene ausgeschlossen, gleichzeitige Klicks sind harmlos (`createMany … skipDuplicates`).
- Gemerkt werden können nur öffentlich sichtbare, fremde Inserate; höchstens 500 je Konto.
- Nicht mehr verfügbare Inserate bleiben auf der Merkliste („Nicht mehr verfügbar“, ohne Bild), bis sie entfernt werden. Wird ein Konto gelöscht, verschwinden seine Einträge (Cascade).
- Die Suchergebnisse bleiben für alle gleich: Herzen auf Karten fragen ihren Status gesammelt in **einer** Anfrage nach (`favorite-store.ts`). Auf eigenen Inseraten erscheint kein Herz.
- Ohne Anmeldung führt das Herz zur Anmeldung (`?weiter=<aktuelle Seite>&hinweis=merken`) und danach zurück.

## Gespeicherte Suchen

- Gespeichert werden die URL-Parameter der Suche. Die API prüft sie mit **derselben Logik wie die Suche** (`ListingSearchService.resolveParams`) und speichert sie in kanonischer Form (ohne Seitenzahl). Unbekannte Parameter fallen weg, ungültige Werte ergeben 400.
- `query_key` (sortierte Parameter) mit Unique-Constraint `(user_id, query_key)`: dieselbe Suche zweimal → 409 „Diese Suche hast du bereits gespeichert.“
- `labels` speichert die Filterbeschreibung zur Anzeige („bis 20.000 €“, „1010 Wien + 50 km“). Höchstens 50 Suchen je Konto.
- **Benachrichtigung:** Ein wiederkehrender Auftrag (`saved-search-alerts`, alle `SAVED_SEARCH_ALERT_MINUTES`) sucht für jede Suche mit Glocke nach Inseraten, die seit `last_checked_at` veröffentlicht wurden, und schickt höchstens eine Sammel-E-Mail je Suche und Lauf (bis zu fünf Treffer und ein Link auf alle). Das Prüffenster endet zwei Minuten vor „jetzt“, weil neue Inserate kurz brauchen, bis sie im Suchindex stehen. Jedes Inserat wird je Suche nur einmal gemeldet.

## Deals und Anbieterprofile (Phase 10)

**Merkliste.** Deals und Anbieterprofile haben eigene Tabellen (`deal_favorites`, `service_favorites`, Primärschlüssel je Konto und Eintrag, Cascade beim Löschen). Die Merkliste der Inserate bleibt unverändert.

- Web: Knopf „Merken“ auf `/deals/[id]` und `/dienstleistungen/[id]`, Reiter auf `/konto/merkliste?art=anzeigen|deals|anbieter`.
- API: `GET /v1/me/favorites/deals`, `PUT/DELETE /v1/me/favorites/deals/:dealId`, `GET /v1/me/favorites/services`, `PUT/DELETE /v1/me/favorites/services/:profileId`.
- Gemerkt werden können nur öffentlich sichtbare, fremde Einträge (eigene → 400, nicht sichtbare → 404). Höchstens 500 je Art und Konto.
- Abgelaufene, pausierte oder gesperrte Einträge bleiben ausgegraut und ohne Bild stehen, bis sie entfernt werden. Gelöschte Anbieterprofile verschwinden aus der Liste, weil von ihnen nichts mehr übrig ist.

**Gespeicherte Suchen.** `saved_searches.kind` (`LISTINGS`, `DEALS`, `SERVICES`, Standard `LISTINGS`). Der Unique-Schlüssel ist jetzt `(user_id, kind, query_key)`: dieselben Parameter als Deal- und als Inseratssuche sind zwei Suchen.

- „Suche speichern“ erscheint auf `/deals` und `/dienstleistungen`, sobald ein Begriff oder Filter gesetzt ist. `/konto/suchen` zeigt die Art und verlinkt auf die passende Seite.
- Die API prüft die Parameter mit derselben Logik wie `/v1/deals` bzw. `/v1/services` (`parseDealSearchParams`, `parseServiceSearchParams`) und speichert sie kanonisch.
- **Keine Benachrichtigungsflut:** Deal- und Anbietersuchen werden höchstens einmal in 24 Stunden geprüft (`SAVED_SEARCH_DIGEST_HOURS`). Daraus entsteht je Suche höchstens eine Sammel-E-Mail am Tag mit bis zu fünf Treffern. Inseratssuchen bleiben bei der bisherigen Taktung.
- Die Migration `20261102090000_favorites_saved_searches` legt den neuen Unique-Index an, bevor der alte entfernt wird. Bestehende Suchen bekommen `LISTINGS`, es gehen keine Daten verloren.

## Nachrichten

- Eine Unterhaltung gehört immer zu einem Inserat und genau zwei Personen (`conversations`, Unique `(listing_id, buyer_id)`). Schreibt der Interessent zum selben Inserat erneut, wird die Unterhaltung fortgesetzt.
- Neue Unterhaltungen nur zu öffentlich sichtbaren Inseraten und nie zu eigenen (zusätzlich CHECK `buyer_id <> seller_id`). Wird das Inserat später pausiert, verkauft oder gelöscht, bleibt die Unterhaltung erhalten und man kann weiterschreiben (Hinweis im Chat).
- Nachrichten sind Klartext, 1–2.000 Zeichen. Zeilenumbrüche werden vereinheitlicht, Steuer- und unsichtbare Richtungszeichen entfernt. HTML wird nie interpretiert: React gibt den Text maskiert aus.
- Lesestatus: `messages.read_at`. Der Chat markiert beim Öffnen und bei neuen Nachrichten (nur wenn das Fenster sichtbar ist) als gelesen; die Absenderin sieht „Zugestellt“ bzw. „Gelesen“.
- Seitenweise: Postfach 20 Unterhaltungen je Seite, Chat die neuesten 30 Nachrichten, ältere per `before=<id>`, verpasste nach einer Unterbrechung per `after=<id>`.

### Echtzeit: Server-Sent Events statt WebSockets

Entscheidung: **SSE**. Begründung:

- Der Datenfluss in Echtzeit geht nur vom Server zum Browser (neue Nachricht, gelesen, Zähler). Gesendet wird über normale Server Actions mit Validierung, Rate-Limits und Fehlermeldungen – dafür braucht es keinen zweiten Kanal.
- Das Access-Token verlässt nie den Server (siehe Sicherheit). Eine SSE-Verbindung lässt sich über eine Next.js-Route (`/api/ereignisse`) mit dem Sitzungs-Cookie durchreichen; der Browser verbindet sich nur mit der eigenen Herkunft. WebSockets bräuchten dafür ein eigenes Ticket-Verfahren und eine eigene Infrastruktur (Sticky Sessions, Upgrade über Proxys).
- `EventSource` verbindet sich nach Unterbrechungen selbst neu; nach dem Wiederverbinden holt der Chat verpasste Nachrichten über `after=<id>`. Ein Herzschlag alle 25 Sekunden hält Verbindungen durch Proxys offen.
- Mehrere API-Instanzen: Ereignisse laufen über Redis Pub/Sub (Kanal `<QUEUE_PREFIX>:events`), jede Instanz liefert sie an ihre eigenen Verbindungen aus. Ohne `REDIS_URL` funktioniert es innerhalb eines Prozesses.

Ereignisse: `ready` (Zähler beim Verbinden), `message`, `read` (mit `byMe`), `ping`.

### E-Mail bei neuen Nachrichten

- Über BullMQ (Redis) als verzögerter Auftrag (`MESSAGE_EMAIL_DELAY_SECONDS`, Standard 120 s). Wer innerhalb dieser Zeit liest, bekommt keine E-Mail.
- **Keine doppelten Benachrichtigungen:** höchstens eine E-Mail je Unterhaltung, bis die Person wieder gelesen hat (`messages.notified_at`); weitere Nachrichten werden in derselben E-Mail gezählt. Gleiche Auftrags-ID je Unterhaltung und Empfänger verhindert parallele Aufträge.
- Der Nachrichtentext steht bewusst nicht in der E-Mail (Datenschutz), nur Name, Anzeige und Link.
- Abschaltbar unter „Benachrichtigungen“ (`users.notify_messages_by_email`, `notify_searches_by_email`).
- Lokal landen alle E-Mails in Mailpit: http://localhost:8025.
- Fehlgeschlagene Aufträge werden bis zu fünfmal mit wachsendem Abstand wiederholt. Ohne `REDIS_URL` laufen Aufträge im Prozess (nicht neustartfest, nur für Entwicklung).

## Sicherheit

- Jede Abfrage einer Unterhaltung ist auf die beiden Beteiligten eingeschränkt (`WHERE id = … AND (buyer_id = me OR seller_id = me)`). Fremde, erfundene oder manipulierte IDs ergeben 404 – ohne zu verraten, ob es die Unterhaltung gibt. IDs werden vor jeder Abfrage per Format geprüft.
- Absender und Empfänger setzt immer der Server; zusätzliche Felder im Request werden abgelehnt (`strict`-Schema).
- **Rate-Limits je Konto** (in der Datenbank gezählt, gelten über alle Instanzen): 10 Nachrichten pro Minute, 100 pro Stunde, 10 neue Unterhaltungen pro Stunde, 30 pro Tag, 10 Meldungen pro Tag. Zusätzlich Limits je IP.
- **Blockieren** sperrt Nachrichten in beide Richtungen, auch neue Unterhaltungen. Inaktive oder gelöschte Konten können nicht mehr angeschrieben werden.
- **Melden** legt eine Meldung in `reports` an (Grund, optionaler Text, Status `OPEN`) und schreibt ins Audit-Log. Bearbeitet wird sie seit Phase 6 im Admin-Bereich; das Team sieht Nachrichten nur zu einer offenen Meldung, nach Bestätigung und protokolliert (siehe [Moderation](moderation.md)).
- Private Nachrichten landen nie im Suchindex: Meilisearch bekommt nur Inserate (`search-document.ts`), ein Test prüft das.
- Datenschutz: Nachrichten werden nur so lange gespeichert, wie beide Konten bestehen (Cascade beim Löschen eines Kontos); Inserate mit Unterhaltungen werden nur „weich“ gelöscht (`Restrict`), damit Gespräche nicht verschwinden.

## Tests

- API (`apps/api/test/*.e2e-spec.ts`): `favorites`, `saved-searches`, `messages` – u. a. fremde Unterhaltungen, manipulierte IDs und Felder, eigene und gelöschte Inserate, Längen, Rate-Limits, Blockieren, Melden, E-Mails über Mailpit, Benachrichtigungen gespeicherter Suchen, SSE-Ereignisse, Suchindex ohne Nachrichten.
- Browser (`apps/web/e2e/interactions.spec.ts`, Desktop und Mobil): zwei echte Konten – Merken (auch über eine neue Sitzung), Anmeldung mit Rücksprung, erste Nachricht, Zähler und E-Mail bei der Anbieterin, Antwort ohne Neuladen, Lesebestätigung, Fremdzugriff, Blockieren, Melden, gespeicherte Suchen von Speichern bis Löschen.
