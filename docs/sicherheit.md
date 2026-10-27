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
- Rollen-Guard (`@Roles()`, rangbasiert) für Moderations- und Admin-Endpunkte (seit Phase 6 in Benutzung, siehe unten).
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
- Blockieren in beide Richtungen, Meldungen in `reports` (bis Phase 5 `user_reports`), beides im Audit-Log.
- E-Mails enthalten keinen Nachrichtentext. Private Nachrichten kommen nie in den Suchindex.
- Die Echtzeit-Verbindung läuft über die eigene Herkunft (`/api/ereignisse`); das Access-Token bleibt auf dem Server.

**Moderation, Rollen und Datenschutz (Phase 6)** – Details in [moderation.md](moderation.md) und [datenschutz.md](datenschutz.md)
- Rollen nur aus der Datenbank, bei jeder Anfrage neu gelesen; JWT-Metadaten und Profil-Updates können sie nicht ändern
  (getestet mit gefälschten `user_metadata`/`app_metadata`). `ADMIN` nur per Kommandozeile (`admin:role`), kein
  Bootstrap-Endpunkt, kein Standardpasswort.
- Alle Routen unter `/v1/admin/*` verlangen mindestens `MODERATOR` (Unit-Test über alle Routen), Kontensuche,
  Rollen, Protokoll und Systemstatistiken `ADMIN`. Keine Selbst-Sperre, keine eigene Rollenänderung, das letzte
  aktive Admin-Konto ist geschützt; Änderungen an Team-Konten laufen serialisiert (Advisory Lock).
- Gesperrte Konten erreichen nur Konto-Status, Entscheidungen, Einspruch, Mitteilungen, Export und Löschung
  (`@AllowSuspended()`); gelöschte Konten bekommen überall 403. Auf öffentlichen Routen gelten beide als Gast.
- Inserate und Bilder gesperrter oder gelöschter Konten sind nicht öffentlich (Detailseite 404, Bilder nur signiert
  für Eigentümer und Team, Suchindex wird sofort aktualisiert).
- Moderationsentscheidungen mit Zeilensperre und Versionsprüfung; Statuswechsel durch Anbieter atomar, damit sie
  keine gleichzeitige Moderationsentscheidung überschreiben.
- Keine automatischen Sperren aufgrund der Anzahl von Meldungen. Doppelte offene Meldungen werden abgewiesen,
  Meldungen sind je Konto begrenzt, missbräuchliche Meldungen werden markiert.
- Private Nachrichten nur zu einer offenen Meldung, nach Bestätigung, begrenzt auf die Zeit bis zur Meldung und im
  Audit-Log protokolliert (ohne Inhalt).
- Kontolöschung nur mit erneuter Passwortprüfung bei Supabase Auth (5 Fehlversuche/Stunde) und Bestätigungswort;
  Konto sofort gesperrt, Löschschritte idempotent mit Wiederholung, Fehlerstatus und Admin-Neustart.
- **Rate-Limits je Konto:** Der Throttler zählt angemeldete Anfragen je Konto (`user:<id>`), sonst je IP – vorher
  teilten sich hinter dem Next.js-Server alle Nutzer eine IP. Mit `REDIS_URL` liegen die Zähler in Redis und gelten
  über alle API-Instanzen (bei Redis-Ausfall wird nicht blockiert). `TRUST_PROXY` setzt Express `trust proxy` für
  den Betrieb hinter einem Load-Balancer.
- Fehlermeldungen von Hintergrundaufträgen werden gekürzt und E-Mail-Adressen maskiert, bevor sie gespeichert oder
  im Dashboard angezeigt werden. Auftrags-Daten enthalten nur IDs.
- Admin-Seiten sind `noindex`; Formulare prüfen IDs vor dem Einsetzen in API-Pfade; Links aus Mitteilungen laufen
  durch `safeRedirectPath`.
- Dependabot (`.github/dependabot.yml`) für npm, GitHub Actions und Docker-Images.

**Monetarisierung (Phase 7)** – Details in [Monetarisierung](monetarisierung.md)
- Preise berechnet nur der Server; Buchungen nehmen keinen Preis an (striktes Schema), Beträge in ganzen Cent mit CHECK.
- Nur eigene, aktive Inserate; gesperrte Konten können nicht buchen; Limits und Stundenlimit unter Advisory-Locks
  (keine Umgehung durch parallele Anfragen); Idempotenz-Schlüssel gegen doppelte Buchungen.
- Nur ADMIN ändert Preise, Aktion und Modus; jede Änderung im Audit-Log mit Vorher/Nachher; Versionsprüfung gegen
  gleichzeitige Änderungen. Der kostenpflichtige Betrieb braucht die Bestätigung `KOSTENPFLICHTIG` und nutzbares Stripe.
- Stripe-Schlüssel nur serverseitig; Webhooks nur mit gültiger Signatur (300 s Toleranz) und genau einmal; Aktivierung
  nur nach Abgleich von Session, Buchung, Betrag, Währung und Modus – eine gefälschte Rückkehr-URL schaltet nichts frei.
  Live-Schlüssel und Live-Ereignisse sind ohne `STRIPE_LIVE_ENABLED=true` gesperrt.
- Abgelaufene Leistungen verlieren ihre Wirkung sofort (Abfragen vergleichen mit „jetzt“).
- Aufrufzählung ohne IP-Speicherung (Pseudonym nur im Arbeitsspeicher, HMAC-Schlüssel tageweise); Logo-Upload über
  eine Route mit Herkunftsprüfung, Bildprüfung und Neukodierung in der API.

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
| 2FA | Umgesetzt in Phase 8 (siehe unten). Offen: Wiederherstellungscodes (Supabase bietet derzeit keine eigenen; Ersatz: zweites Gerät oder Zurücksetzen durch die Administration). |
| Monitoring und Alarmierung | Phase 8: Healthchecks, Systemzustand und Fehlerübersicht im Admin-Bereich, JSON-Logs ([betrieb.md](betrieb.md)). Offen: externer Dienst (Sentry o. Ä.) und Alarme per E-Mail/Chat – brauchen Freigabe. |
| Endgültige Löschung soft-gelöschter Inserate | Vom Anbieter gelöschte Inserate bleiben als `DELETED` erhalten; Frist und Löschauftrag festlegen (inkl. Bilder in R2). |
| Bilder im Datenexport | Export enthält Bild-Metadaten, nicht die Dateien. |
| Meldungen ohne Konto | Meldeformular nur angemeldet; ob das nach Art. 16 DSA reicht, rechtlich prüfen. |
| Bild-Uploads | Umgesetzt (siehe [bilder.md](bilder.md)). Offen: automatische Inhaltsprüfung (z. B. bekannte Missbrauchsdarstellungen). |

## Phase 8: Härtung vor dem Start

**Zwei-Faktor-Anmeldung (TOTP)**
- Über Supabase MFA; Einrichtung unter `/konto/sicherheit` (nur Team-Konten), bis zu 3 Geräte.
- `STAFF_MFA_REQUIRED` (Standard in Produktion: an): Admin- und Moderationsrouten verlangen eine Sitzung mit
  `aal2`. Die API prüft das selbst anhand des Tokens (`MfaGuard`), unabhängig von der Web-App.
- Kritische Aktionen (Konto sperren/entsperren, Rolle ändern, 2FA zurücksetzen, Preise/Einstellungen, Umstellung
  auf kostenpflichtig) verlangen zusätzlich einen frischen Code (`@StepUp`, höchstens `STEP_UP_MAX_AGE_MINUTES` alt).
- Aussperren verhindert: Der letzte Faktor lässt sich bei 2FA-Pflicht nicht entfernen; Zurücksetzen durch eine
  andere Administration oder per Kommandozeile ([betrieb.md](betrieb.md#notfälle)). Alles wird protokolliert.

**Robustheit gegen doppeltes Abschicken**
- Nachrichten tragen eine `clientId`, neue Inserate eine `clientRequestId` (eindeutig je Konto). Wiederholte
  Anfragen – Doppelklick, Wiederholen nach Zeitüberschreitung – liefern den schon gespeicherten Eintrag.
  Buchungen hatten bereits einen Idempotenzschlüssel (Phase 7).

**Suchmaschinen**: bis zum Start vollständig `noindex`; private Bereiche immer (siehe [betrieb.md](betrieb.md#suchmaschinen)).
Strukturierte Daten werden so serialisiert, dass Inseratstexte das `<script>`-Element nicht verlassen können.

## Backup-Konzept (für den Produktionsbetrieb)

Lokale Routine und Probelauf: [betrieb.md](betrieb.md#sicherung-und-wiederherstellung).


- Postgres: tägliche automatische Backups mit Point-in-Time-Recovery (bei verwalteten Anbietern Standard), Aufbewahrung 14–30 Tage, Speicherort in der EU.
- Zusätzlich wöchentlicher `pg_dump` in einen getrennten Bucket mit anderer Zugangsberechtigung.
- R2-Bilder: Versionierung bzw. Lifecycle-Regeln; gelöschte Inserate erst nach Frist endgültig entfernen.
- Wiederherstellung mindestens einmal pro Quartal testen und das Ergebnis dokumentieren.
