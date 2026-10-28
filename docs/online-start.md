# Online-Start Schritt für Schritt (Windows + Ubuntu-Server)

> Stand 28.10.2026. Nichts davon ist schon passiert: Es gibt keinen Server, keine Domain, kein Brevo-, Awin- oder
> Produktions-R2-Konto. **Alles, was Geld kostet oder MarktAT öffentlich macht, entscheidet und klickt Niko selbst.**
> Technischer Hintergrund: [deployment.md](deployment.md). Partnerangebote: [affiliate.md](affiliate.md).

Was wo eingetragen wird, auf einen Blick:

| Angabe | Wo eintragen | Nie |
| --- | --- | --- |
| Domain, DNS-Einträge | Verwaltung beim Domain-Registrar | – |
| SMTP-Zugang (Brevo) | Server: `/opt/marktat/.env` (`SMTP_*`, `MAIL_FROM*`) | GitHub, Repository, Chat |
| R2-Schlüssel (Produktion) | Server: `/opt/marktat/.env` (`R2_*`) | GitHub, Repository, Chat |
| Awin-Schlüssel | Server: `/opt/marktat/.env` (`AWIN_*`) | GitHub, Repository, Chat |
| Datenbank-, Redis-, Suche-, Auth-Geheimnisse | erzeugt `setup-server.sh` selbst auf dem Server | anfassen, kopieren |
| SSH-Zugang für das Ausrollen | GitHub → Repository → Settings → Environments → `production` → Secrets (`DEPLOY_HOST`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`) | Repository, Chat |
| Betreiberangaben (Impressum) | an Claude geben → `apps/web/src/content/operator.ts` (öffentliche Angaben) | – |

## Teil A – am Windows-PC

Alle Befehle in **PowerShell** (Start → „PowerShell“). OpenSSH ist in Windows 10/11 enthalten.

### A1. Zwei SSH-Schlüssel erzeugen

```powershell
mkdir $HOME\.ssh -Force
cd $HOME\.ssh
# 1) dein persönlicher Schlüssel für root (mit Passwort schützen, wenn gefragt)
ssh-keygen -t ed25519 -f marktat-root -C "niko-marktat-root"
# 2) Schlüssel nur für GitHub Actions (ohne Passwort, sonst kann der Workflow ihn nicht nutzen)
ssh-keygen -t ed25519 -f marktat-deploy -N '""' -C "github-deploy"
```

Ergebnis: `marktat-root` / `marktat-root.pub` und `marktat-deploy` / `marktat-deploy.pub` in `C:\Users\<du>\.ssh\`.
Die Dateien **ohne** `.pub` sind geheim.

### A2. Domain registrieren (Registrar)

1. Bei einem Registrar deiner Wahl (z. B. ein österreichischer für `.at`) die Domain kaufen. *Kostenpflichtig,
   ca. 10–20 €/Jahr.* Name und Markenrechte vorher prüfen („MarktAT“ ist ein Arbeitstitel).
2. Die DNS-Einträge kommen erst nach A3 dazu (dafür braucht es die Server-IP).

### A3. Server bei Hetzner bestellen

1. [console.hetzner.cloud](https://console.hetzner.cloud) → Konto anlegen → **Neues Projekt** „MarktAT“.
2. Projekt → **Sicherheit → SSH-Keys → SSH-Key hinzufügen** → Inhalt von `marktat-root.pub` einfügen
   (`Get-Content $HOME\.ssh\marktat-root.pub | Set-Clipboard`).
3. **Server hinzufügen**: Standort Nürnberg oder Falkenstein (sonst Helsinki), Image **Ubuntu 24.04**, Typ
   **CX33** (x86, nicht ARM), Netzwerk: öffentliche IPv4 an, SSH-Key aus Schritt 2, **Backups** an, Name `marktat-1`.
   *Kostenpflichtig, ca. 12,83 €/Monat brutto.*
4. Die **IPv4-Adresse** des Servers notieren (Übersicht).

### A4. DNS beim Registrar eintragen

| Name | Typ | Wert |
| --- | --- | --- |
| `@` (bzw. `marktat.at`) | A | IPv4 des Servers |
| `api` (bzw. `api.marktat.at`) | A | IPv4 des Servers |
| `_dmarc` | TXT | `v=DMARC1; p=none; rua=mailto:<deine-adresse>` |
| Einträge von Brevo (A5) | TXT / CNAME | genau wie Brevo sie anzeigt |

Keinen AAAA-Eintrag (IPv6) anlegen. Prüfen in PowerShell: `Resolve-DnsName marktat.at` zeigt die Server-IP (kann bis
zu einigen Stunden dauern).

### A5. E-Mail-Versand bei Brevo (Gratistarif, 300 E-Mails/Tag)

1. [brevo.com](https://www.brevo.com) → kostenloses Konto anlegen (Free-Tarif).
2. **Senders, Domains & Dedicated IPs → Domains → Add a domain** → deine Domain → „Authenticate“: Brevo zeigt einen
   TXT-Eintrag (Brevo-Code) und DKIM-Einträge. Diese 1:1 beim Registrar eintragen (A4), dann bei Brevo „Verify“.
3. **Senders → Add a sender**: `noreply@<deine-domain>`, Name „MarktAT“.
4. **SMTP & API → SMTP** → „Generate a new SMTP key“. Angezeigt werden Server `smtp-relay.brevo.com`, Port `587`,
   ein **Login** (Form `…@smtp-brevo.com`) und der **SMTP-Schlüssel** (nur einmal sichtbar, in den Passwortmanager).
5. Auftragsverarbeitungsvertrag (DPA) von Brevo in den Kontoeinstellungen annehmen.

### A6. Cloudflare R2 für die Produktion

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **R2 Object Storage → Create bucket**: Name `marktat-prod`,
   Standort automatisch oder EU („Jurisdiction“ EU nur, wenn gewünscht – dann `R2_JURISDICTION=eu`). Bucket bleibt
   privat (kein „Public access“).
2. Bucket → **Settings → CORS Policy → Add**:
   ```json
   [{ "AllowedOrigins": ["https://<deine-domain>"], "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3600 }]
   ```
3. Bucket → **Settings → Object lifecycle rules**: Präfix `uploads/`, „Delete objects after 1 day“.
4. R2-Übersicht → **Manage API tokens → Create API token**: Berechtigung **Object Read & Write**, nur für Bucket
   `marktat-prod`. Notieren: **Access Key ID**, **Secret Access Key** (nur einmal sichtbar) und die **Account ID**
   (rechts in der R2-Übersicht). Gratis bis 10 GB.

### A7. GitHub vorbereiten (Secrets erst nach B2 vollständig)

1. [github.com/n1kob1ko/marktat](https://github.com/n1kob1ko/marktat) → **Settings → Environments → New environment**
   → Name `production` → optional **Required reviewers: n1kob1ko** (dann wartet jedes Ausrollen auf deinen Klick).
2. Im Environment `production` → **Environment secrets → Add environment secret**:
   - `DEPLOY_HOST` = IPv4 des Servers
   - `DEPLOY_SSH_KEY` = Inhalt der Datei `marktat-deploy` (privat!):
     `Get-Content $HOME\.ssh\marktat-deploy -Raw | Set-Clipboard`
   - `DEPLOY_KNOWN_HOSTS` = Ausgabe von `ssh-keyscan -t ed25519 <server-ip>` (erst nach B2, wenn der Server läuft)

## Teil B – auf dem Ubuntu-Server

### B1. Anmelden

```powershell
ssh -i $HOME\.ssh\marktat-root root@<server-ip>
```

Beim ersten Mal den Fingerabdruck mit „yes“ bestätigen.

### B2. Einrichten (einmalig, ca. 5 Minuten)

Den Inhalt von `marktat-deploy.pub` vorher am PC kopieren (`Get-Content $HOME\.ssh\marktat-deploy.pub | Set-Clipboard`).

```bash
curl -fsSLO https://raw.githubusercontent.com/n1kob1ko/marktat/main/infra/production/setup-server.sh
less setup-server.sh                      # lesen, mit q beenden
bash setup-server.sh "ssh-ed25519 AAAA… github-deploy"   # öffentlichen Deploy-Schlüssel einfügen
```

Danach: Updates, Docker, Firewall (nur 22/80/443), fail2ban, Benutzer `deploy`, `/opt/marktat/.env` mit allen
Geheimnissen, tägliche Sicherung um 03:30. Jetzt am PC `ssh-keyscan -t ed25519 <server-ip>` ausführen und die Ausgabe
als `DEPLOY_KNOWN_HOSTS` eintragen (A7).

### B3. Werte in `/opt/marktat/.env` eintragen

```bash
nano /opt/marktat/.env      # speichern: Strg+O, Enter; beenden: Strg+X
```

| Variable | Wert |
| --- | --- |
| `WEB_DOMAIN` | z. B. `marktat.at` |
| `API_DOMAIN` | z. B. `api.marktat.at` |
| `ACME_EMAIL` | deine E-Mail (Warnungen zu Zertifikaten) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | `smtp-relay.brevo.com` / `587` / `false` |
| `SMTP_USER` / `SMTP_PASSWORD` | Login und SMTP-Schlüssel aus A5 |
| `MAIL_FROM` / `MAIL_FROM_ADDRESS` | `"MarktAT <noreply@marktat.at>"` / `noreply@marktat.at` |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | aus A6 |
| `R2_BUCKET` / `R2_JURISDICTION` | `marktat-prod` / `default` (oder `eu`) |
| `BETA_BASIC_AUTH` | für den ersten, geschlossenen Test z. B. `test:<langes-passwort>` (siehe B5) |
| `AWIN_ENABLED` | bleibt `false` (Teil C) |

Nicht ändern: alle bereits ausgefüllten Geheimnisse, `STRIPE_LIVE_ENABLED=false`, `STAFF_MFA_REQUIRED=true`.
`BACKUP_PASSPHRASE` zusätzlich in den Passwortmanager kopieren (`grep BACKUP_PASSPHRASE /opt/marktat/.env`) – ohne sie
sind Sicherungen wertlos.

### B4. Ausrollen

1. GitHub → **Actions → Deployment → Run workflow** (Feld leer lassen = neuester grüner Stand von `main`).
2. Der Workflow prüft den Stand, baut die Images, prüft die `.env` auf dem Server, sichert die Datenbank, migriert,
   startet und macht einen Rauchtest; bei Fehlern rollt er automatisch zurück. Dauer ca. 10–15 Minuten.
3. Kontrolle auf dem Server: `/opt/marktat/current/deploy.sh status`.

### B5. Erster Test – noch geschlossen

Solange `BETA_BASIC_AUTH` gesetzt ist, fragt der Browser nach Benutzer und Passwort: Die Seite ist erreichbar, aber
nicht öffentlich.

1. `https://<WEB_DOMAIN>` öffnen, registrieren, E-Mail bestätigen.
2. Admin werden: `/opt/marktat/current/deploy.sh compose exec api pnpm admin:role -- --email <adresse> --role ADMIN`
3. `/admin` öffnen → 2FA mit einer Authenticator-App einrichten.
4. Checkliste „Online-Funktionstest“ in [deployment.md](deployment.md#online-funktionstest-nach-dem-ersten-deployment-über-die-echte-adresse)
   durchgehen (inkl. Deals, Importe, Dienstleistungen, Projekte, Moderation, Partnerprogramme-Seite).

### B6. Veröffentlichen – nur mit deiner ausdrücklichen Entscheidung

Voraussetzungen: Online-Funktionstest bestanden, Betreiberangaben im Impressum (an Claude geben), Rechtstexte geprüft
([rechtliches.md](rechtliches.md)). Dann in `/opt/marktat/.env` `BETA_BASIC_AUTH=` leeren und neu ausrollen
(Actions → Deployment → Run workflow). Die Seite bleibt `noindex`, bis du die Indexierung freigibst.

## Teil C – Awin (Partnerangebote), erst nach dem Online-Start

Awin prüft bei der Anmeldung die Website, deshalb erst, wenn MarktAT öffentlich erreichbar ist.

1. [awin.com](https://www.awin.com) → **Publisher werden** (kostenlos; 1 € Kaution, die mit der ersten Auszahlung
   zurückkommt). Website `https://<WEB_DOMAIN>/deals`, Werbeform „Preisvergleich/Gutscheine/Content“, Region
   Österreich. **Nicht** den Advertiser-Tarif wählen.
2. Bei gewünschten Händlern (Advertisers) bewerben und Programmbedingungen lesen: Bilder? UVP? Gutscheincodes?
   Erlaubtes Werbeumfeld?
3. Schlüssel holen: **Benutzermenü → API Credentials → Show my API token**; **Toolbox → Create-a-Feed** → in der
   Download-Adresse der Teil nach `apikey/`; Publisher-ID oben links im Konto.
4. Auf dem Server in `/opt/marktat/.env`: `AWIN_PUBLISHER_ID`, `AWIN_API_TOKEN`, `AWIN_FEED_API_KEY`, dann
   `AWIN_ENABLED=true`; neu ausrollen (Actions → Deployment). Der Ausroll-Check lehnt unvollständige Werte ab.
5. MarktAT → `/admin/affiliate`: „Jetzt abrufen“ → Programme erscheinen → je Programm „Freigabe bearbeiten“
   (Dokumentation, Häkchen laut Bedingungen, 2FA-Code) → Feed „Aktivieren“. Ab dann läuft alles automatisch
   (stündlich Feedliste, Feeds nur bei neuem Stand, Aktionen alle 4 Stunden).

Provisionen sind Einnahmen: steuerliche Behandlung und ob dafür ein Gewerbe nötig ist, mit Steuerberatung klären.

## Laufende Kosten

| Posten | Kosten/Monat |
| --- | --- |
| Hetzner CX33 + IPv4 + Backups | ≈ 12,83 € brutto |
| Domain `.at` | ≈ 1–2 € |
| Brevo (Free), Cloudflare R2 (bis 10 GB), Awin Publisher, Uptime-Dienst (Gratistarif) | 0 € |
| **Summe** | **≈ 14–15 €** |
