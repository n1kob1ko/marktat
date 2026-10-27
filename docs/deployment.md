# Online-Betrieb (Deployment)

> Stand 27.10.2026 (Phase 9): Alles ist vorbereitet und lokal geprobt. **Es gibt noch keinen Server und keine Domain**;
> online ist nichts. Buchungen, Kosten und die Freigabe zur Veröffentlichung entscheidet Niko.
> Preise unten sind recherchierte Listenpreise vom 27.10.2026, vor einer Buchung beim Anbieter prüfen.

## Überblick

Ein Server in der EU mit Docker Compose. Von außen erreichbar ist nur Caddy (Ports 80 und 443, automatisches HTTPS
über Let's Encrypt). Alles andere liegt im internen Docker-Netz ohne veröffentlichte Ports.

```
Browser ──HTTPS──► Caddy ─┬─ marktat.at ────────────► web (Next.js)  ──intern──► api
                          └─ api.marktat.at ─┬─ /auth/v1/* ► auth (Supabase Auth/GoTrue, selbst betrieben)
                                             └─ alles andere ► api (NestJS) ─► db (PostgreSQL+PostGIS), redis,
                                                                                meilisearch, Cloudflare R2, SMTP
```

| Datei | Zweck |
| --- | --- |
| `infra/production/compose.yml` | alle Dienste, Healthchecks, Neustart `unless-stopped`, Log-Rotation |
| `infra/production/Caddyfile` | HTTPS, Sicherheits-Header, Admin-API von Supabase Auth nur intern, optionaler Zugangsschutz |
| `infra/production/env.production.example` | Vorlage für `/opt/marktat/.env` |
| `infra/production/generate-secrets.mjs` | erzeugt alle Geheimnisse auf dem Server (füllt nur leere Einträge) |
| `infra/production/deploy.sh` | Prüfen, Ausrollen, Zurückrollen, Status, `compose …` für Verwaltung |
| `infra/production/backup.sh` | verschlüsselte Sicherung, Prüfung, Wiederherstellung |
| `infra/production/setup-server.sh` | Ersteinrichtung des Servers (Ubuntu 24.04) |
| `infra/production/probe/` | lokale Generalprobe des ganzen Ablaufs (nie auf dem Server) |
| `.github/workflows/deploy.yml` | Deployment von Hand, nur für Stände von `main` mit grüner CI |
| `apps/api/Dockerfile`, `apps/web/Dockerfile` | Images; das Web-Image enthält die öffentlichen Adressen fest |

## Empfehlung: Hosting

**Ein EU-Server (VPS) mit Docker Compose bei Hetzner** (Rechenzentren in Deutschland und Finnland), Ubuntu 24.04,
Typ **CX33** (4 vCPU, 8 GB RAM, 80 GB SSD), mit Hetzner-Backups. Supabase Auth läuft selbst mit auf dem Server.

| Kriterium | EU-VPS + Docker Compose (empfohlen) | Verwaltete Dienste (z. B. Supabase Cloud + PaaS + Managed DB) |
| --- | --- | --- |
| Kosten (Beta) | ca. 11–13 €/Monat gesamt | Supabase Free pausiert Projekte nach 7 Tagen ohne Nutzung; Supabase Pro 25 $/Monat, dazu Hosting für API, Web, Redis, Meilisearch (geschätzt weitere 20–40 $/Monat) |
| Wartung | Betriebssystem-Updates automatisch; Docker-Images über unsere Updates; ca. 1 h/Monat Kontrolle | geringer, aber mehrere Konten, Dashboards und Verträge |
| Sicherungen | tägliche verschlüsselte DB-Sicherung (eigenes Skript, getestet) + Hetzner-Server-Backups (7 Stände) + optional extern in R2 | beim Anbieter enthalten (je nach Tarif) |
| Leistung | für die Beta reichlich (eine Maschine, kurze Wege zwischen den Diensten) | gut, aber Wege zwischen Anbietern über das Internet |
| Skalierung | senkrecht in Minuten (größerer Typ, gleiche Daten); waagrecht erst mit Umbau | einfacher waagrecht, Kosten steigen mit |
| Datenschutz | ein Auftragsverarbeiter für alle Kerndaten, EU | mehrere Auftragsverarbeiter, teils USA |
| Abhängigkeit | gering (Standard-Docker, jederzeit zu anderem Anbieter umziehbar) | höher |

Preise Hetzner Cloud (ab 15.6.2026, netto, zzgl. 20 % USt.; öffentliche IPv4 +0,50 €; Backups +20 % des Serverpreises;
20 TB Datenverkehr inklusive):

| Typ | Leistung | Preis/Monat netto |
| --- | --- | --- |
| CX23 | 2 vCPU, 4 GB, 40 GB | 5,49 € |
| **CX33** | **4 vCPU, 8 GB, 80 GB** | **8,49 €** |
| CX43 | 8 vCPU, 16 GB | 15,99 € |
| CPX22 | 2 vCPU (AMD), 4 GB | 19,49 € |

Hinweise: CX-Typen sind seit etwa Juni 2026 an manchen Standorten zeitweise „nicht verfügbar“ – dann einen anderen
EU-Standort wählen. Keine ARM-Typen (CAX): das PostGIS-Image gibt es nur für amd64.
Alternative: netcup VPS 1000 G12.5 (4 vCore, 8 GB, 128 GB, Standort u. a. Wien) für 12,32 €/Monat brutto, aber
24 Monate Mindestlaufzeit.

### Realistische Monatskosten (Beta)

| Posten | Kosten |
| --- | --- |
| Hetzner CX33 + IPv4 + Backups | 8,49 + 0,50 + 1,70 = 10,69 € netto ≈ **12,83 € brutto** |
| Domain (.at) | ca. 10–20 €/Jahr ≈ 1–2 €/Monat |
| E-Mail-Versand | 0 € im Gratistarif (Brevo: 300 E-Mails/Tag) |
| Cloudflare R2 (Bilder) | 0 € bis 10 GB und im Gratiskontingent für Zugriffe |
| Überwachung (UptimeRobot o. ä. Gratistarif) | 0 € |
| **Summe** | **ca. 14–15 €/Monat** |

Mit CX23 statt CX33 (4 GB RAM, für eine kleine Beta knapp ausreichend, 2 GB Swap richtet das Setup ein) sinkt das auf
etwa 10 €/Monat.

## Was Niko einrichten muss

1. **Domain** registrieren (Vorschlag: eine `.at`-Domain bei einem österreichischen Registrar; Name entscheidet Niko,
   „MarktAT“ ist ein Arbeitstitel – Verfügbarkeit und Markenrechte vorher prüfen). Benötigt werden zwei Adressen,
   z. B. `marktat.at` (Web) und `api.marktat.at` (API und Anmeldung).
2. **Hetzner-Konto** und Server CX33, Ubuntu 24.04, Standort Nürnberg/Falkenstein (oder Helsinki), mit eigenem
   SSH-Schlüssel für root und aktivierten Backups. *Kostenpflichtig – braucht Nikos Freigabe.*
3. **DNS-Einträge** (beim Registrar):

   | Name | Typ | Wert |
   | --- | --- | --- |
   | `marktat.at` | A | IPv4 des Servers |
   | `api.marktat.at` | A | IPv4 des Servers |
   | Absenderdomain | TXT (SPF), CNAME/TXT (DKIM) | genau wie vom E-Mail-Dienst angezeigt |
   | `_dmarc.marktat.at` | TXT | `v=DMARC1; p=none; rua=mailto:<adresse>` – nach 2–4 Wochen ohne Fehler auf `p=quarantine` |

   Vorerst **keinen AAAA-Eintrag (IPv6)**: Docker reicht IPv6-Verbindungen sonst mit einer internen Adresse weiter, und
   Rate-Limits würden alle IPv6-Nutzer:innen zusammenzählen. IPv6 kommt später mit IPv6 im Docker-Netz.
4. **E-Mail-Versand**: Konto bei einem Transaktionsdienst in der EU, z. B. **Brevo** (Gratistarif, 300 E-Mails/Tag,
   SMTP `smtp-relay.brevo.com`, Port 587) oder **Scaleway Transactional Email** (300 E-Mails/Monat gratis, danach
   0,25 € je 1000). Absenderdomain verifizieren (SPF/DKIM), Absender z. B. `noreply@marktat.at`, SMTP-Zugang anlegen.
   AV-Vertrag des Anbieters annehmen.
5. **Cloudflare R2**: eigener Bucket für die Produktion (z. B. `marktat-prod`, privat, Standort EU wählbar) und ein
   eigenes API-Token „Object Read & Write“ nur für diesen Bucket. CORS-Regel: Origin `https://<WEB_DOMAIN>`,
   Methoden `PUT`, `GET`, Header `content-type` (wie in [bilder.md](bilder.md)). Optional ein zweiter Bucket nur für
   Sicherungen (`marktat-backups`) mit eigenem Token und Lifecycle-Regel „löschen nach 30 Tagen“.
6. **GitHub**: Repository-Einstellungen → Environments → `production` anlegen, optional „Required reviewers: Niko“
   (dann wartet jedes Deployment auf Nikos Klick). Secrets dort:
   - `DEPLOY_HOST` – IPv4 oder Name des Servers
   - `DEPLOY_SSH_KEY` – privater Schlüssel (`ssh-keygen -t ed25519 -f marktat-deploy -N ""`, Inhalt von `marktat-deploy`)
   - `DEPLOY_KNOWN_HOSTS` – Ausgabe von `ssh-keyscan -t ed25519 <server-ip>` (nach dem Einrichten des Servers)
7. **Betreiberangaben** für Impressum, Datenschutz und Kontakt, siehe [rechtliches.md](rechtliches.md#was-niko-liefern-muss).
8. Optional **Überwachung**: kostenloses Konto bei einem externen Uptime-Dienst, Prüfung auf
   `https://<API_DOMAIN>/v1/health/ready` und `https://<WEB_DOMAIN>/` alle 5 Minuten, Alarm per E-Mail.

## Ersteinrichtung (einmalig)

1. Server bestellen (siehe oben), als root anmelden.
2. `setup-server.sh` laden, lesen, ausführen – mit dem **öffentlichen** Schlüssel `marktat-deploy.pub`:
   ```bash
   curl -fsSLO https://raw.githubusercontent.com/n1kob1ko/marktat/main/infra/production/setup-server.sh
   bash setup-server.sh "$(cat marktat-deploy.pub)"   # oder den Schlüssel direkt einfügen
   ```
   Ergebnis: Updates, Docker, Firewall (nur 22/80/443), fail2ban, automatische Sicherheitsupdates, Benutzer `deploy`,
   `/opt/marktat/.env` aus der Vorlage **mit bereits erzeugten Geheimnissen**, tägliche Sicherung um 03:30.
3. In `/opt/marktat/.env` eintragen (z. B. `nano /opt/marktat/.env`): `WEB_DOMAIN`, `API_DOMAIN`, `ACME_EMAIL`,
   `SMTP_*`, `MAIL_FROM`, `MAIL_FROM_ADDRESS`, `R2_*`. Geheimnisse nicht verändern, nicht kopieren.
4. DNS-Einträge setzen und warten, bis `dig +short <WEB_DOMAIN>` die Server-IP zeigt.
5. GitHub-Secrets setzen (oben, Punkt 6), dann **Actions → Deployment → Run workflow**. Der Workflow liest die
   öffentlichen Werte vom Server, baut die Images, kopiert die Konfiguration und ruft `deploy.sh deploy` auf.
   Beim ersten Start holt Caddy die Zertifikate (Ports 80/443 müssen offen sein).
6. Erstes Administratorkonto: auf der Website registrieren und E-Mail bestätigen, dann auf dem Server
   ```bash
   /opt/marktat/current/deploy.sh compose exec api pnpm admin:role -- --email <adresse> --role ADMIN
   ```
   Beim nächsten Öffnen von `/admin` verlangt MarktAT die Einrichtung der Zwei-Faktor-Anmeldung.
7. Online-Funktionstest (Checkliste unten) und erst danach den Link teilen.

## Updates

1. Claude entwickelt auf einem Branch, CI testet, Merge auf `main` erst bei grüner CI.
2. Deployment **nur von Hand**: Actions → Deployment → Run workflow (leer = neuester Stand von `main`, oder ein
   bestimmter Commit). Der Workflow bricht ab, wenn der Commit nicht auf `main` liegt oder keine grüne CI hat.
3. `deploy.sh deploy <tag>` auf dem Server:
   1. Konfiguration prüfen (`pnpm env:check` im neuen Image: Pflichtwerte, keine Entwicklungsgeheimnisse, 2FA an,
      Stripe live aus, Sicherungspasswort gesetzt)
   2. **Sicherung** beider Datenbanken (verschlüsselt)
   3. Migrationen (`prisma migrate deploy`) und Grunddaten (idempotent, ohne Demo-Inserate)
   4. neue Container starten, warten bis alle Healthchecks grün sind
   5. Rauchtest über HTTPS: `/v1/health/ready`, `/auth/v1/health`, Startseite
   6. bei Fehler in 4./5.: **automatisch zurück zur vorigen Version**; bei Fehler in 1.–3. läuft die alte Version
      unverändert weiter
4. Unterbrechung je Update: einige Sekunden bis ca. 30 s, während die Container neu starten.

**Migrationen** müssen abwärtskompatibel sein (neue Spalten/Tabellen ja; Umbenennen oder Löschen nur in zwei Schritten
über zwei Versionen), weil beim Zurückrollen die Datenbank auf dem neuen Stand bleibt.

### Zurückrollen und Notfall

```bash
/opt/marktat/current/deploy.sh status      # laufende und vorige Version, Healthchecks
/opt/marktat/current/deploy.sh rollback    # vorige Version starten (ohne Migrationen)
/opt/marktat/current/deploy.sh compose logs --tail 200 api web auth caddy
tail -50 /opt/marktat/deploy.log
```

Ist eine Migration selbst das Problem: Daten aus der Sicherung vor dem Deployment zurückspielen (unten), danach
`rollback`.

## Sicherungen

- täglich 03:30 (cron) und vor jedem Deployment: `pg_dump` von `marktat` und `marktat_auth`, mit gpg (AES-256)
  verschlüsselt, in `/opt/marktat/backups/`, Aufbewahrung `BACKUP_RETENTION_DAYS` (Standard 14 Tage)
- optional zusätzlich in einen eigenen R2-Bucket (`BACKUP_R2_*`)
- **`BACKUP_PASSPHRASE` zusätzlich offline aufbewahren** (Passwortmanager) – ohne sie sind die Sicherungen wertlos
- Hetzner-Backups sichern zusätzlich den ganzen Server (7 Stände)
- Bilder liegen in R2 (keine eigene Sicherung; R2 speichert redundant). Suchindex lässt sich neu aufbauen, Redis
  enthält nur kurzlebige Warteschlangen.

```bash
/opt/marktat/current/backup.sh verify /opt/marktat/backups/marktat-<zeit>-daily.dump.gpg   # Probe, ändert nichts
/opt/marktat/current/backup.sh restore /opt/marktat/backups/marktat-<zeit>-daily.dump.gpg  # fragt nach, sichert vorher
/opt/marktat/current/deploy.sh compose exec api pnpm search:reindex                       # nach einer Wiederherstellung
```

Wiederherstellung einmal im Quartal auf der Generalprobe üben (siehe unten).

## Überwachung

- `https://<API_DOMAIN>/v1/health/ready` prüft Datenbank, Redis, Suche, Supabase Auth und E-Mail-Versand
- Admin-Bereich → System: Zustand der Dienste und Fehlerübersicht
- externer Uptime-Dienst (Punkt 8 oben) alarmiert, wenn die Seite nicht erreichbar ist
- Speicherplatz: `df -h /` und `docker system df` monatlich; Logs sind je Container auf 5 × 10 MB begrenzt

## Verwaltung am laufenden System

```bash
D=/opt/marktat/current/deploy.sh
$D compose exec api pnpm admin:role -- --email <adresse> --role ADMIN|MODERATOR|USER
$D compose exec api pnpm admin:mfa-reset -- --email <adresse>
$D compose exec api pnpm search:reindex
$D compose ps
```

## Sicherheit im Online-Betrieb

- `noindex` ist **kein** Zugangsschutz: die Beta ist für alle erreichbar, die die Adresse kennen. Deshalb gilt
  derselbe Schutz wie nach dem Start: HTTPS überall (HSTS), Cookies `secure` + `httpOnly`, Rate-Limits je Person,
  2FA für das Team, Admin-API von Supabase Auth von außen gesperrt (403), keine offenen internen Ports.
- Optional `BETA_BASIC_AUTH=benutzer:passwort` in der `.env` sperrt die Web-App zusätzlich mit HTTP-Basic-Auth (z. B.
  für eine geschlossene Probephase); nach Änderung neu ausrollen.
- Eigene Geheimnisse je Umgebung, nur auf dem Server (`/opt/marktat/.env`, Rechte 600); GitHub kennt nur den
  SSH-Schlüssel. Keine Entwicklungsdaten auf dem Server (die Startprüfung erkennt Entwicklungswerte).
- Der Benutzer `deploy` ist Mitglied der Gruppe `docker` und damit faktisch root auf dem Server: den privaten
  Deploy-Schlüssel nur in GitHub-Secrets ablegen.
- Docker umgeht die Firewall für veröffentlichte Ports – veröffentlicht wird nur Caddy (80/443).
- Kostenlos: `STRIPE_*` leer, `STRIPE_LIVE_ENABLED=false`; die Startprüfung bricht sonst ab.

## Generalprobe (lokal, vor Änderungen an dieser Konfiguration)

`infra/production/probe/probe.sh <ordner>` spielt den echten `deploy.sh`-Ablauf mit den Produktions-Images auf einem
Entwicklungsrechner durch: HTTPS über Caddy mit lokalen Zertifikaten (`https://marktat.localhost`), Mailpit statt
Versanddienst (`http://127.0.0.1:8026`), ein S3-Ersatz statt R2. Danach Browser-Tests:

```bash
E2E_BASE_URL=https://marktat.localhost MAILPIT_URL=http://127.0.0.1:8026 E2E_IGNORE_HTTPS_ERRORS=true \
E2E_ROLE_COMMAND="docker compose -p marktat-probe exec -T api pnpm --silent admin:role --" \
pnpm --filter @marktat/web exec playwright test core-flows interactions security monetization category-fields
```

Die Suchtests brauchen Demo-Inserate und laufen deshalb nur lokal gegen die Entwicklungsumgebung. Der Test
„Admin verwaltet Preise“ erwartet einen Admin ohne 2FA und scheitert in der Probe erwartungsgemäß an der 2FA-Pflicht.
Aufräumen: `docker compose -p marktat-probe down -v`.

**Ergebnis der Probe am 27.10.2026** (lokal, nicht online): Erstinstallation, zwei Updates, automatisches Zurückrollen
nach absichtlich kaputter Version, manuelles Zurückrollen, Sicherung, Prüfung und Wiederherstellung erfolgreich;
Browser-Tests (Desktop und Mobil) für Registrierung mit E-Mail-Bestätigung, Anmelden, Passwort zurücksetzen,
Inserieren, Bild-Upload, Merken, Nachrichten in Echtzeit, gespeicherte Suchen, Händlerprofil, kostenlose
Zusatzleistungen, Admin mit 2FA und Zurücksetzen der 2FA bestanden. Von außen geprüft: nur 80/443 offen, HTTP leitet
auf HTTPS um, Admin-API von Supabase Auth liefert 403 (auch mit gültigem Service-Key), Cookies `secure`/`httpOnly`,
`noindex` aktiv.

## Online-Funktionstest (nach dem ersten Deployment, über die echte Adresse)

Ergebnisse mit Datum in diesem Abschnitt festhalten. Lokale Proben zählen nicht.

- [ ] Registrierung mit echter E-Mail-Adresse, Bestätigungs-E-Mail kommt an (auch Spam-Ordner prüfen), Link funktioniert
- [ ] Anmelden, Abmelden, Passwort zurücksetzen per E-Mail
- [ ] Inserat veröffentlichen, Bilder hochladen (landen im R2-Bucket `marktat-prod`), Bilder werden angezeigt
- [ ] Suche (Text, Kategorie, Umkreis), Merkliste
- [ ] Nachricht zwischen zwei Konten in Echtzeit, E-Mail-Benachrichtigung zu ungelesener Nachricht
- [ ] Händlerkonto mit Firmenangaben, Händlerseite
- [ ] kostenlose Zusatzleistungen buchen (Top-Anzeige, Hervorhebung) – keine Zahlung, kein Stripe
- [ ] Admin-Bereich mit 2FA, Moderation einer Meldung, Systemseite grün
- [ ] Handy (iOS Safari, Android Chrome): Startseite, Inserieren mit Kamera-Foto, Nachrichten
- [ ] `https://<WEB_DOMAIN>/robots.txt` sperrt alles; Header `X-Robots-Tag: noindex`
- [ ] SPF/DKIM/DMARC „pass“ in einer empfangenen E-Mail (Original anzeigen)

## Bekannte Grenzen

- Ein einzelner Server: fällt er aus, ist MarktAT offline (Wiederherstellung aus Hetzner-Backup oder auf neuem Server
  mit `setup-server.sh` + Sicherung).
- Kein IPv6 (siehe DNS).
- Kurze Unterbrechung bei jedem Update; Caddy startet dabei ebenfalls neu (Zertifikate bleiben erhalten).
- `setup-server.sh` und der GitHub-Workflow konnten mangels Server noch nicht auf echter Infrastruktur laufen; der
  Ablauf dahinter (`deploy.sh`, `backup.sh`, Images, Compose) ist lokal geprobt.
