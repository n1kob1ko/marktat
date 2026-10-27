# Händlerfunktionen und Statistik (Phase 7)

## Öffentliches Händlerprofil `/haendler/[id]`

Für gewerbliche, aktive Konten (`GET /v1/dealers/:id?seite=`). Zeigt Firmenname, Logo, Beschreibung („Über mich“),
Geschäftsanschrift, Website (nur `https://`, `rel="nofollow"`), Telefon nur bei Freigabe (`show_phone`),
Firmenbuchnummer und UID (Anbieterkennzeichnung), „Auf MarktAT seit“ und alle aktiven Anzeigen (24 je Seite,
Reihenfolge wie „Neueste“ inklusive Hochschieben). Kontakt läuft über die bestehenden Nachrichten je Anzeige; die
Detailseite einer Händleranzeige verlinkt auf das Profil.

**Logo:** `PUT /v1/me/logo` (Rohdaten JPEG/PNG/WebP, max. 5 MB, mind. 64 × 64 px) → `sharp` dreht, entfernt Metadaten
und speichert 400 px WebP unter `logos/<konto>/<uuid>.webp`; das alte wird gelöscht. Öffentlich über
`/v1/dealers/:id/logo` (Weiterleitung, 30 min Cache). Die Web-App lädt über die Route `/api/logo` hoch (gleiche
Herkunft, Token bleibt auf dem Server; Server Actions wären auf 1 MB begrenzt). Bei Kontolöschung wird das Logo
gelöscht.

## Händler-Dashboard `/konto/haendler`

`GET /v1/me/dealer-dashboard` (403 für private Konten): Anzeigen nach Status (aktiv, pausiert, abgelaufen, Entwürfe),
Aufrufe 30 Tage und gesamt, Merklisten, Anfragen 30 Tage und gesamt, aktive Top-Anzeigen und Hervorhebungen,
Hochschieben in 30 Tagen, Kontingente je Leistung, meistgesehene Anzeigen und fehlende Profilangaben (Firmenname,
Geschäftssitz, Firmenbuchnummer oder UID, Beschreibung, Logo). Händlerpakete sind vorbereitet, Abos gibt es nicht.

## Statistik je Anzeige `/konto/anzeigen/[id]/statistik`

`GET /v1/listings/:id/stats` (nur Eigentümer bzw. Team, sonst 404): Aufrufe gesamt und je Tag (30 Tage, Säulen mit
Tabellenansicht), Merklisten, Anfragen, interessierte Personen (gemerkt oder angeschrieben, ohne Doppelte), Erstellt,
Veröffentlicht, Online bis, zuletzt hochgeschoben, aktive Leistungen mit Enddatum. Keine erfundenen Zahlen: Tage ohne
Aufrufe stehen mit 0 da, und die Seite nennt, seit wann gezählt wird.

### Wie Aufrufe gezählt werden

```
Browser (ViewBeacon, einmal je Sitzung) → POST /api/aufrufe (Next.js, gleiche Herkunft)
  → Bots/Automatisierung per User-Agent verworfen, nur Sec-Fetch-Site: same-origin
  → Pseudonym sha256(IP | User-Agent), nie gespeichert
  → POST /v1/listings/:id/views { visitor } mit Sitzungs-Token
API: nur aktive Inserate; Eigentümer und Team zählen nie
  → Schlüssel HMAC(Inserat, Konto bzw. Pseudonym, Wiener Tag), Redis SET NX (26 h)
  → listing_view_days (Tagessumme) + listings.view_count
```

Jede Person zählt je Anzeige höchstens einmal pro Kalendertag; Neuladen zählt nicht. Gespeichert werden nur
Tagessummen – keine IP, kein Pseudonym, kein Verlauf je Person. Ohne Redis (Tests) entfernt ein Speicher im Prozess
die Wiederholungen. Hinter einem Proxy `TRUST_PROXY` setzen: die Web-App reicht die Client-IP als
`X-Forwarded-For` weiter, damit das Rate-Limit (120/min) je Person und nicht für alle gemeinsam gilt.
