# Sicherheit und Datenschutz (technisch)

## Umgesetzt in Phase 1

**Authentifizierung**
- Passwörter, Sitzungen, E-Mail-Bestätigung und Passwort-Reset ausschließlich über Supabase Auth. Keine Passwörter in unserer Datenbank.
- Passwortregeln: 10–72 Zeichen, mindestens ein Buchstabe und eine Ziffer (Web, API-Schema und GoTrue).
- Anmeldung erst nach bestätigter E-Mail. Die Passwort-vergessen-Antwort ist immer gleich, damit sich nicht prüfen lässt, ob eine Adresse registriert ist; dasselbe gilt für eine Registrierung mit bereits vorhandener Adresse.
- Die API prüft jedes Token selbst (Signatur, Ablauf, Issuer, Audience, `role = authenticated`). Rollen kommen nur aus unserer Datenbank.
- Sitzungs-Cookies sind HttpOnly und werden im Next.js-Proxy (`src/proxy.ts`) erneuert.

**Autorisierung**
- Globaler Auth-Guard: jeder Endpunkt ist geschützt, außer er ist ausdrücklich mit `@Public()` markiert.
- Rollen-Guard (`@Roles()`) für spätere Moderations- und Admin-Endpunkte.
- Eigentümerprüfung serverseitig bei jeder Änderung; fremde Inserate liefern 404.

**Eingaben**
- Alle Request-Bodies und Query-Parameter werden mit Zod validiert; unbekannte Felder werden verworfen.
- Body-Limit 100 kB. Preise als Ganzzahl in Cent mit Obergrenze.
- Prisma verwendet parametrisierte Abfragen; die wenigen Raw-Queries nutzen Tagged Templates (ebenfalls parametrisiert).
- React escapt Ausgaben; es wird kein Nutzer-HTML gerendert.
- Weiterleitungen nach dem Login nur auf interne Pfade (`safeRedirectPath`), kein Open Redirect.
- Honeypot-Feld bei der Registrierung gegen einfache Bots.

**Transport und Header**
- API: `helmet`, CORS nur für `WEB_URL`, Bearer-Tokens statt Cookies (daher kein CSRF-Angriffsweg auf die API).
- Web: CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS in Produktion.
- Server Actions in Next.js prüfen den Origin selbst (CSRF-Schutz).

**Missbrauch**
- Rate-Limit global (`RATE_LIMIT_PER_MINUTE`, Standard 120/min je IP) und 20/min für schreibende Inserat-Endpunkte.
- GoTrue hat eigene Limits für Anmeldung und E-Mail-Versand (lokal hoch gesetzt, in Produktion Supabase-Standard).

**Nachrichten (Phase 5)**
- Unterhaltungen nur für die beiden Beteiligten; fremde oder manipulierte IDs ergeben 404, Absender/Empfänger setzt der Server.
- Rate-Limits je Konto in der Datenbank (wirken auch hinter dem Next.js-Server und über mehrere Instanzen): 10 Nachrichten/Minute, 100/Stunde, 10 neue Unterhaltungen/Stunde, 30/Tag, 10 Meldungen/Tag.
- Klartext ohne HTML-Interpretation, Steuer- und Richtungszeichen werden entfernt, 2.000 Zeichen Höchstlänge (auch als Spaltenlänge).
- Blockieren in beide Richtungen, Meldungen in `user_reports`, beides im Audit-Log.
- E-Mails enthalten keinen Nachrichtentext. Private Nachrichten kommen nie in den Suchindex.
- Die Echtzeit-Verbindung läuft über die eigene Herkunft (`/api/ereignisse`); das Access-Token bleibt auf dem Server.

**Protokollierung**
- `audit_logs` für Profilanlage und -änderung, Anlegen, Veröffentlichen, Verlängern, Pausieren, Fortsetzen und Löschen von Inseraten sowie neue Unterhaltungen, Blockieren und Melden. IPs werden gekürzt gespeichert (IPv4 /24, IPv6 /48), keine Tokens oder Passwörter.
- Fehlerantworten enthalten keine Stacktraces oder SQL-Details.

**Geheimnisse**
- Nur Entwicklungswerte im Repo (`.env.example`); `.env` ist in `.gitignore`.
- `SUPABASE_SERVICE_ROLE_KEY` und `SUPABASE_JWT_SECRET` nur serverseitig; im Browser landet nur der öffentliche Anon-Key.

## Offen (bewusst noch nicht umgesetzt)

| Thema | Plan |
| --- | --- |
| CSP mit Nonce | Aktuell `'unsafe-inline'` für Skripte, weil Next.js Inline-Skripte erzeugt. Umstellung auf Nonce über den Proxy, sobald die Seiten-Caching-Strategie feststeht. |
| Reverse-Proxy/IP | Hinter Load-Balancer muss `trust proxy` gesetzt werden, sonst greift das Rate-Limit pro Proxy-IP statt pro Nutzer. |
| Rate-Limit verteilt | Throttler speichert im Speicher; bei mehreren API-Instanzen Redis-Storage verwenden. |
| Bild-Uploads | Umgesetzt (siehe [bilder.md](bilder.md)): signierte, kurzlebige Upload-URLs, Typ- und Größenprüfung vor und nach dem Upload, Inhaltsprüfung, Neukodierung ohne EXIF/GPS, privater Bucket. Offen: automatische Inhaltsmoderation (Phase 3). |
| Kontolöschung/Datenexport | Phase 3 (DSGVO Art. 17/20) über die Supabase-Admin-API. |
| 2FA | Supabase unterstützt TOTP; Aktivierung für Händler und Admins in Phase 3. |
| Monitoring | Sentry o. Ä. und Alarmierung in Phase 6. |
| Abhängigkeiten | Dependabot/Renovate aktivieren. |

## Backup-Konzept (für den Produktionsbetrieb)

- Postgres: tägliche automatische Backups mit Point-in-Time-Recovery (bei verwalteten Anbietern Standard), Aufbewahrung 14–30 Tage, Speicherort in der EU.
- Zusätzlich wöchentlicher `pg_dump` in einen getrennten Bucket mit anderer Zugangsberechtigung.
- R2-Bilder: Versionierung bzw. Lifecycle-Regeln; gelöschte Inserate erst nach Frist endgültig entfernen.
- Wiederherstellung mindestens einmal pro Quartal testen und das Ergebnis dokumentieren.
