# Bilder (Cloudflare R2)

Stand: Phase 2. Inseratsbilder liegen in Cloudflare R2. Der Bucket bleibt **privat**: Weder Rohdateien noch fertige
Bilder sind direkt öffentlich. Der Browser bekommt nur kurzlebige, signierte URLs.

## Ablauf

```
Browser                    Web (Server Action)          API                          R2 (privat)
  │ Datei wählen               │                          │                             │
  │ ──requestImageUpload──────►│ POST /images/uploads ───►│ Eigentümer? ≤ 10 Bilder?    │
  │                            │                          │ Typ JPEG/PNG/WebP, ≤ 15 MB  │
  │ ◄──── signierte PUT-URL (5 min, Typ + Größe mitsigniert) ◄─│                         │
  │ ──────────────────────────────── PUT uploads/<inserat>/<bild> ────────────────────────►│
  │ ──completeImageUpload─────►│ POST /images/:id/complete►│ Größe prüfen, Datei laden   │
  │                            │                          │ Inhalt prüfen (sharp)       │
  │                            │                          │ EXIF/GPS entfernen, drehen  │
  │                            │                          │ large.webp + thumb.webp ───►│ images/<inserat>/<bild>/
  │                            │                          │ Rohdatei löschen ──────────►│
  │ <img src="API/v1/images/<bild>/thumb">                │                             │
  │ ─────────────────────────────────────────────────────►│ fertig + Inserat aktiv?     │
  │ ◄──────────── 302 auf signierte GET-URL (1 h) ─────────│                             │
  │ ──────────────────────────────────────────────────────────── GET ────────────────────►│
```

| Regel | Umsetzung |
| --- | --- |
| Schlüssel nie im Browser | Nur die API kennt `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`. Der Browser bekommt pro Datei eine URL, die 5 Minuten für genau einen Schlüssel, einen Content-Type und eine Dateigröße gilt. |
| Max. 10 Bilder, 15 MB | Bei der Anmeldung (laufende Uploads zählen mit) und nach dem Upload erneut (tatsächliche Größe in R2). |
| JPEG, PNG, WebP | Angekündigter Typ wird geprüft, maßgeblich ist aber der **Dateiinhalt** (sharp erkennt das Format). Text, SVG, GIF, beschädigte oder abgeschnittene Dateien werden abgelehnt und gelöscht. |
| Metadaten | Alle Varianten werden neu als WebP kodiert; EXIF (inkl. GPS), XMP und IPTC werden entfernt, die EXIF-Ausrichtung vorher angewendet. |
| Varianten | `large` (max. 1600 px, WebP q82) für die Detailseite, `thumb` (480 × 360, Bildausschnitt automatisch) für Listen. |
| Hauptbild/Reihenfolge | `sortOrder` 0 ist das Hauptbild. Endpunkte zum Umsortieren, Hauptbild setzen, Löschen. |
| Berechtigung | Nur der Eigentümer des Inserats. Fremde Inserate und Bilder liefern 404. |
| Keine öffentlichen Rohdaten | Rohdateien liegen unter `uploads/` und werden nie über eine Lese-URL ausgegeben. Die API signiert Lese-URLs nur für fertige Varianten und nur, wenn das Inserat aktiv ist (oder für den Eigentümer über eine zeitlich begrenzte Signatur). |
| Abgebrochene Uploads | Nach 1 Stunde verworfen (zählen nicht mehr zum Limit); zusätzlich löscht eine R2-Aufräumregel `uploads/` nach 1 Tag. |

API-Endpunkte (Details unter `http://localhost:4000/docs`, Bereich „Inseratsbilder“):

| Methode | Pfad |
| --- | --- |
| GET | `/v1/listings/:id/images` |
| POST | `/v1/listings/:id/images/uploads` |
| POST | `/v1/listings/:id/images/:imageId/complete` |
| PUT | `/v1/listings/:id/images/order` |
| POST | `/v1/listings/:id/images/:imageId/main` |
| DELETE | `/v1/listings/:id/images/:imageId` |
| GET | `/v1/images/:imageId/large` · `/thumb` (öffentlich, 302 auf R2) |

## Einrichtung für die lokale Entwicklung

### 1. Werte in die lokale `.env`

Nur in deiner lokalen `.env`, niemals committen:

```bash
STORAGE_DRIVER=r2
R2_ACCOUNT_ID=…          # Cloudflare-Dashboard → R2 → rechts „Account ID“ (32 Zeichen)
R2_ACCESS_KEY_ID=…       # R2 → „Manage API tokens“ → Token mit „Object Read & Write“ für marktat-dev
R2_SECRET_ACCESS_KEY=…
R2_BUCKET=marktat-dev
R2_JURISDICTION=default  # „eu“, wenn der Bucket mit Jurisdiktion EU angelegt wurde
```

**Jurisdiktion:** Wurde der Bucket mit „Specify jurisdiction → European Union“ angelegt, ist er nur unter
`https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com` erreichbar. Dann `R2_JURISDICTION=eu` setzen. Die Einstellung
steht im Dashboard beim Bucket unter „Settings“. Der Verbindungstest (Schritt 3) erkennt eine falsche Jurisdiktion.

### 2. CORS-Regel am Bucket

Der Browser lädt direkt zu R2 hoch, deshalb braucht der Bucket eine CORS-Regel. Dashboard → R2 → `marktat-dev` →
Settings → CORS Policy → Add:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

Für Produktion später die echte Domain ergänzen. Empfohlen außerdem: Settings → Object lifecycle rules → Regel für
Präfix `uploads/`, „Delete objects after 1 day“. Mit einem Token mit „Admin Read & Write“ setzt
`pnpm --filter @marktat/api r2:check --setup` beides automatisch.

Den Bucket **nicht** öffentlich machen (kein „Public Development URL“, keine Custom Domain auf diesen Bucket),
sonst wären auch unverarbeitete Uploads abrufbar.

### 3. Verbindung testen

```bash
pnpm install
pnpm --filter @marktat/api r2:check
```

Der Test gibt keine Geheimnisse aus und prüft:
- Bucket erreichbar, Zugangsdaten gültig (bei falscher Jurisdiktion mit Hinweis auf die richtige)
- Upload über signierte URL, Ablehnung bei falscher Größe und falschem Content-Type
- Rohdatei ohne Signatur nicht abrufbar
- Verarbeitung (EXIF weg, WebP-Varianten) und Abruf über signierte Lese-URL
- CORS für `WEB_URL`

Alle Testobjekte liegen unter `r2-check/` und werden danach gelöscht.

### 4. Bild hochladen und anzeigen

```bash
pnpm infra:up
pnpm db:migrate
pnpm dev
```

1. http://localhost:3000 → anmelden (oder registrieren, Bestätigungslink in Mailpit unter http://localhost:8025).
2. „Inserat aufgeben“ → Formular ausfüllen → „Anzeige veröffentlichen“. Danach öffnet sich die Bildverwaltung.
3. Bilder hineinziehen oder „Bilder auswählen“. Fortschritt, dann „Wird optimiert …“, dann erscheint das Vorschaubild.
4. Mit ★ das Hauptbild wählen, mit ← → sortieren, mit 🗑 löschen. „Fertig“ führt zur Anzeige mit Galerie.
5. Die Startseite und die Suche zeigen das Hauptbild als Vorschau.

In R2 liegen danach nur `images/<inserat>/<bild>/large.webp` und `thumb.webp`; `uploads/` ist wieder leer.

Für bestehende Anzeigen: Detailseite → „Bilder (n)“ oder Bearbeiten → „Bilder verwalten“.

## Ohne R2 (Tests, offline)

`STORAGE_DRIVER=local` speichert unter `apps/api/.storage/` und simuliert signierte URLs über die API
(`/v1/local-storage/…`, HMAC-signiert, gleiche Prüfungen auf Typ und Größe). Die automatisierten Tests und die CI nutzen
diesen Treiber, brauchen also keine Cloudflare-Zugangsdaten. In Produktion verweigert die API den Start mit diesem
Treiber. Fehlen bei `STORAGE_DRIVER=r2` die Zugangsdaten, startet die API trotzdem; nur die Bild-Endpunkte antworten mit 503.

## Produktion (später)

- Eigener Bucket je Umgebung, Token nur mit „Object Read & Write“ auf diesen Bucket.
- `APP_SIGNING_SECRET` setzen (Pflicht, mind. 32 Zeichen).
- Bei viel Traffic: fertige Varianten in einen zweiten, öffentlichen Bucket mit Custom Domain und CDN-Cache kopieren;
  der Upload-Bucket bleibt privat. Die Bild-URLs der API (`/v1/images/...`) bleiben dabei gleich.
- Verarbeitung bei Bedarf in eine BullMQ-Warteschlange verlagern (derzeit synchron, ca. 0,3–1 s pro Bild).
- Weiterleitungen werden 30 Minuten zwischengespeichert: Ein pausiertes Inserat kann bei Besuchern, die das Bild
  gerade geladen haben, bis dahin noch aus dem Browser-Cache erscheinen.
