# Betrieb: Sicherung, Überwachung, Notfälle

Technische Betriebsanleitung für die lokale Umgebung. Der Online-Betrieb (Server, Deployment, verschlüsselte
Sicherungen, Wiederherstellung, Überwachung) steht in [deployment.md](deployment.md); Staging in [staging.md](staging.md).

## Sicherung und Wiederherstellung

### Lokal (Docker-Umgebung)

| Befehl | Wirkung |
| --- | --- |
| `pnpm --filter @marktat/api db:backup` | `pg_dump` von `marktat` (App) und `marktat_auth` (Konten von Supabase Auth) nach `backups/<db>-<zeit>.dump`. Liest nur. |
| `pnpm --filter @marktat/api db:backup -- --db marktat` | nur eine Datenbank |
| `pnpm --filter @marktat/api db:restore -- --file <datei> --target <neue_db>` | Wiederherstellung in eine **neue** Datenbank. Bricht ab, wenn es die Zieldatenbank schon gibt oder sie zur Entwicklungsumgebung gehört (`marktat`, `marktat_auth`, `marktat_test`, `marktat_shadow`). |
| `pnpm --filter @marktat/api db:backup-check` | Probelauf: temporäre Datenbank mit allen Migrationen und synthetischen Daten → Sicherung → Wiederherstellung in eine zweite temporäre Datenbank → Zeilenzahl und Prüfsumme jeder Tabelle vergleichen → beide löschen. Läuft auch in der CI. |

`pg_dump`/`pg_restore` laufen im Datenbank-Container; lokal sind keine PostgreSQL-Werkzeuge nötig.

**Sicherungsdateien enthalten personenbezogene Daten** (E-Mail-Adressen, Nachrichten, Passwort-Hashes in
`marktat_auth`). `backups/` steht in `.gitignore`; Dateien verschlüsselt und getrennt vom Rechner aufbewahren und
nach Gebrauch löschen.

**Die Entwicklungsdatenbank tatsächlich zurücksetzen** ist absichtlich kein Skript: erst wiederherstellen in eine
neue Datenbank, prüfen, dann bei gestoppter API `DATABASE_URL` auf die neue Datenbank zeigen lassen. Docker-Volumes
werden dafür nicht gelöscht.

**Migrationen:** `pnpm --filter @marktat/api db:check-migrations` vergleicht `schema.prisma` mit den Migrationen
(braucht `SHADOW_DATABASE_URL`, siehe `.env.example`; bei bestehenden Volumes `marktat_shadow` einmal anlegen:
`CREATE DATABASE marktat_shadow;` und die Erweiterungen `postgis`, `pg_trgm`). Migrationen sind bisher rein additiv.
Vor jeder Migration im Livebetrieb: Sicherung ziehen, Migration auf einer wiederhergestellten Kopie testen.

### Bilder (R2 bzw. lokaler Speicher)

Bilder liegen nicht in der Datenbank, sondern in R2 (`marktat-dev`) bzw. bei `STORAGE_DRIVER=local` in
`apps/api/.storage/`. Eine Datenbanksicherung ohne Bilder ergibt Inserate mit fehlenden Fotos, aber keine kaputten
Daten (Bilder werden über ihren Schlüssel nachgeladen).

Offen – Entscheidung nötig, ggf. mit Kosten:
- regelmäßige Kopie des Buckets in einen zweiten Bucket bzw. Speicherort (z. B. mit `rclone`), getrennte Zugangsdaten
- wie lange gelöschte Bilder in der Kopie bleiben dürfen (Datenschutz, siehe [datenschutz.md](datenschutz.md))

### Livebetrieb (Vorschlag, nicht umgesetzt)

- Verwalteter PostgreSQL-Dienst mit täglichen Sicherungen und Point-in-Time-Recovery in der EU.
- Zusätzlich regelmäßiger `pg_dump` beider Datenbanken an einen getrennten Ort.
- Wiederherstellung mindestens vierteljährlich auf einer separaten Datenbank testen (`db:restore` + Stichproben)
  und das Ergebnis festhalten.
- Aufbewahrungsdauer der Sicherungen ist eine rechtliche/organisatorische Entscheidung (siehe [rechtliches.md](rechtliches.md)).

## Überwachung

| Was | Wo |
| --- | --- |
| Lebenszeichen | `GET /v1/health` (unverändert, für Docker/Load-Balancer) |
| Bereitschaft | `GET /v1/health/ready` → `ok`, `degraded` (z. B. Redis oder Suche weg, Plattform läuft eingeschränkt) oder `503` (Datenbank weg) |
| Systemzustand | Admin-Bereich → **System**: Datenbank, Redis, Suche, Anmeldung, E-Mail, Warteschlange, Prozess |
| Fehlerübersicht | Admin-Bereich → **System**: unerwartete Fehler gruppiert (Anzahl, erstes/letztes Auftreten, Anfrage-ID); Einträge verschwinden 30 Tage nach dem letzten Auftreten |
| Logs | API mit `LOG_FORMAT=json` (Standard in Produktion): eine JSON-Zeile je Anfrage (Methode, Routenmuster, Status, Dauer, Anfrage-ID) und je Fehler. Ohne IP, Query-String, Token, Pfad-IDs. Web: `web_request_error` je Serverfehler. |
| Anfrage-ID | Antwort-Header `X-Request-Id`, steht auch in 500-Antworten und in der Fehlerübersicht – damit lassen sich Meldungen von Nutzerinnen und Nutzern zuordnen. |

### Verhalten bei Ausfällen (geprüft am 27.10.2026, lokal)

| Ausfall | Verhalten |
| --- | --- |
| Redis | Plattform nutzbar; Aufträge (E-Mails) laufen ersatzweise im API-Prozess, Echtzeit nur innerhalb einer Instanz, Rate-Limit im Speicher. API startet auch ohne Redis. |
| Meilisearch | Suche fällt automatisch auf PostgreSQL zurück. |
| Supabase Auth | Bestehende Sitzungen funktionieren weiter; Anmelden/Registrieren zeigt „Die Anmeldung ist gerade nicht erreichbar …“, Eingaben bleiben erhalten. |
| Datenbank / API | Startseite und Anmeldeseite laden; Seiten mit Daten zeigen eine deutsche Fehlerseite mit „Erneut versuchen“. Nach der Störung erholt sich alles ohne Neustart. |

### Sentry o. Ä. (vorbereitet, nicht aktiv)

Es ist **kein** externer Dienst angebunden und es fallen keine Kosten an. Anschlusspunkte, falls freigegeben:
- API: `ErrorReporter.capture()` in `apps/api/src/monitoring/error-reporter.ts` – dort zusätzlich an das SDK melden.
  Die Meldung ist bereits datensparsam (E-Mail-Adressen und IDs ersetzt).
- Web: `onRequestError` in `apps/web/src/instrumentation.ts`.
- Vor der Aktivierung: AV-Vertrag, EU-Region, `sendDefaultPii: false`, keine Request-Bodies/Cookies, Sampling.

## Notfälle

### Zwei-Faktor-Anmeldung verloren (Admin/Moderation)

1. Andere Administration: Admin-Bereich → Konto → **Zwei-Faktor-Anmeldung zurücksetzen** (Identität vorher auf
   anderem Weg prüfen; Bestätigung mit eigenem Code).
2. Niemand mehr mit Zugang: auf dem Server
   `pnpm --filter @marktat/api admin:mfa-reset -- --email <adresse>` (wird im Protokoll vermerkt).

Die Person meldet sich danach mit Passwort an und richtet 2FA unter `/konto/sicherheit` neu ein.
Ist `STAFF_MFA_REQUIRED=true` (Standard in Produktion), führt der Admin-Bereich bis dahin zur Einrichtung.

### Rollen

Administrationsrechte nur über die Kommandozeile: `pnpm --filter @marktat/api admin:role -- --email <adresse> --role ADMIN`.

### Suchindex neu aufbauen

`pnpm --filter @marktat/api search:reindex`

## Suchmaschinen

Bis zum offiziellen Start ist Indexierung gesperrt: `robots.txt` sperrt alles, jede Antwort trägt
`X-Robots-Tag: noindex, nofollow`, Seiten haben `<meta name="robots" content="noindex, nofollow">`.
Freischalten: `ALLOW_INDEXING=true` **beim Build** der Web-App setzen (der Wert wird beim Build festgelegt).
Konto, Admin, Nachrichten, Inserieren, Anmeldung usw. bleiben auch danach `noindex`. Die Sitemap
(`/sitemap.xml`) enthält dann öffentliche Inserate, Händlerprofile mit aktiven Inseraten und Kategorien.

## Leistung (Messung Phase 8)

Produktionsbuild lokal (`next start`, API `node dist/main.js`), Chromium mit Pixel-7-Profil, Median aus 5–7
Aufrufen, übertragene (komprimierte) Größen. Lokale Werte ohne Netzwerklatenz – für den Vergleich vorher/nachher,
nicht als Aussage über echte Mobilnetze.

| Seite | JS vorher | JS nachher | gesamt vorher | gesamt nachher | LCP vorher | LCP nachher |
| --- | --- | --- | --- | --- | --- | --- |
| Startseite | 244,1 KB | 164,7 KB | 393,9 KB | 314,6 KB | 184 ms | 148 ms |
| Suche | 253,2 KB | 183,0 KB | 409,4 KB | 339,7 KB | 444 ms | 440–472 ms |
| Suche mit Filtern und Umkreis | 253,2 KB | 183,0 KB | 423,1 KB | 354,3 KB | 492 ms | 440 ms |
| Inseratsseite | 247,9 KB | 168,8 KB | 388,2 KB | 312,5 KB | 116 ms | 384–412 ms |
| Anmelden | 248,7 KB | 169,4 KB | 391,4 KB | 313,4 KB | 80 ms | 104 ms |

**Maßnahme:** `@marktat/shared` ist als nebenwirkungsfrei markiert (`"sideEffects": false`); die deutsche
Sprache für zod hängt jetzt an `schemas/zod.ts` statt am Paketeinstieg. Dadurch lädt eine Seite die
Validierungsbibliothek nur noch, wenn ein Formular sie wirklich braucht (vorher auf jeder Seite, ca. 82 KB
komprimiert, wegen eines Datumsformats in der Inseratskarte). Konstanten wie `MESSAGE_MAX_LENGTH` liegen in
`limits.ts`, damit das Kontaktformular zod nicht nachzieht.

**LCP bei gestreamten Bereichen:** Inhalte, die nach dem ersten Bild per Streaming kommen (Suchergebnisse,
Inseratsdetails), deckt React gebündelt auf – höchstens alle 300 ms, außer kurz vor der 2,5-s-Grenze. Ist ein
kleiner Bereich (z. B. „Anmelden“ im Kopf) zuerst fertig, erscheint der Hauptinhalt bis zu 300 ms später. Daher
schwanken diese Werte zwischen ~120 und ~470 ms; alle liegen deutlich unter 2,5 s („gut“ nach Core Web Vitals).
Bewusst nicht umgangen, weil das Bündeln Layout-Sprünge vermeidet.

Messskript: Playwright mit CDP (übertragene Bytes je Ressourcentyp, `largest-contentful-paint`); nicht Teil des
Repositorys, weil die Werte nur auf derselben Maschine vergleichbar sind.
