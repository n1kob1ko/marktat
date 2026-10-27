# Moderation, Rollen und Meldungen (Phase 6)

> ⚠️ Die Abläufe orientieren sich am Digital Services Act (DSA). Ob sie für MarktAT ausreichen, muss eine
> österreichische Rechtsberatung prüfen – siehe „Offene Punkte für die Rechtsprüfung“ unten.

## Rollen

| Rolle | Darf |
| --- | --- |
| `USER` | Inserieren, Nachrichten, Inserate und Unterhaltungen melden, eigene Entscheidungen einsehen und Einspruch erheben |
| `MODERATOR` | Admin-Bereich ohne Kontensuche und Protokoll: Meldungen bearbeiten (übernehmen, Priorität, Notiz, ohne Maßnahme schließen), Inserate prüfen, deaktivieren, ausblenden und freigeben, normale Konten (`USER`) sperren, Einsprüche entscheiden (nicht zu Team-Konten) |
| `ADMIN` | Zusätzlich: Konten suchen, E-Mail-Adressen sehen, Sperren aufheben, Team-Konten sperren, Moderationsrechte vergeben und entziehen, Meldefunktion einschränken, fehlgeschlagene Löschungen neu starten, Systemstatistiken und Audit-Log |

- Rollen stehen **nur** in der Datenbank (`users.role`). Der Auth-Guard liest sie bei jeder Anfrage neu; Angaben aus dem
  Token (`user_metadata`, `app_metadata`) oder aus Profil-Updates werden ignoriert. Ein Rollenwechsel wirkt sofort.
- Der Rollen-Guard ist rangbasiert (`ADMIN` ⊃ `MODERATOR` ⊃ `USER`). Der ganze Controller `admin/*` verlangt
  mindestens `MODERATOR`; ein Unit-Test (`admin-routes.spec.ts`) prüft, dass jede Route dort eine Rolle hat.
- Im Web gibt es `/admin` für alle anderen nicht (404). Die API prüft trotzdem jede Anfrage selbst.
- Niemand kann die eigene Rolle ändern oder sich selbst sperren. `ADMIN` wird nie über die Oberfläche vergeben.
- Das letzte aktive Administratorkonto kann weder gesperrt, herabgestuft noch gelöscht werden. Alle Änderungen an
  Team-Konten laufen nacheinander (`pg_advisory_xact_lock`), damit sich zwei Admins nicht gleichzeitig gegenseitig sperren.

### Erstes Administratorkonto

Es gibt keinen Bootstrap-Endpunkt und kein hinterlegtes Passwort. Die Person registriert sich normal, bestätigt die
E-Mail und meldet sich einmal an. Dann auf dem Server (mit Zugriff auf die `.env`):

```bash
pnpm --filter @marktat/api admin:role -- --email anna@example.at --role ADMIN
pnpm --filter @marktat/api admin:role -- --list        # Team anzeigen
```

Jede Änderung landet im Audit-Log (`admin.role_changed`, `via: cli`). Moderationsrechte vergeben Admins danach in
`/admin/nutzer/<id>`.

## Meldungen

- **Inserate** meldet man über „Anzeige melden“ auf der Detailseite (`/melden?anzeige=<id>`), **Unterhaltungen** im
  Chat-Menü. Eine Anmeldung ist nötig.
- Gründe: Betrugsverdacht, Verbotener Artikel, Irreführende Angaben, Spam, Belästigung, Sonstiger Regelverstoß
  (in Unterhaltungen nur Betrug, Belästigung, Spam, Sonstiges).
- Inserat-Meldungen brauchen eine Begründung (10–1.000 Zeichen) und die Bestätigung, dass die Angaben nach bestem
  Wissen richtig sind (Art. 16 Abs. 2 DSA).
- Missbrauchsschutz: höchstens 10 Meldungen je Konto und Tag, 10 je Minute; dieselbe Person kann denselben Inhalt
  nur einmal offen melden (409). Eigene Inserate lassen sich nicht melden.
- **Priorität:** Betrugsverdacht und verbotene Artikel starten mit „Hoch“, alles andere mit „Normal“. Die Liste ist
  nach Priorität und Alter sortiert; mehrere Meldungen zum selben Inhalt werden als „+n weitere“ angezeigt.
- **Keine automatischen Sperren:** Die Anzahl der Meldungen ändert nie den Status eines Inserats oder Kontos. Jede
  Maßnahme trifft ein Mensch.
- **Status:** `OPEN` → `IN_REVIEW` (übernommen oder vorläufig ausgeblendet) → `RESOLVED` (Maßnahme) oder
  `DISMISSED` (kein Verstoß). Jeder Schritt steht im Verlauf (`report_events`) mit Person und Zeitpunkt.
- **Missbräuchliche Meldungen:** Beim Schließen ohne Maßnahme kann „offensichtlich unbegründet“ markiert werden.
  Die Zahl solcher Meldungen steht bei der meldenden Person. Admins können die Meldefunktion befristet einschränken
  (Art. 23 DSA) – nach vorheriger Warnung, nie automatisch.
- Die meldende Person bekommt eine Mitteilung, sobald die Meldung erledigt ist (ohne Details zur Maßnahme gegen andere).

## Entscheidungen

| Maßnahme | Von Status | Neuer Status | Meldungen |
| --- | --- | --- | --- |
| Inserat deaktivieren (`REJECT`) | aktiv, pausiert, abgelaufen, in Prüfung | `REJECTED` | erledigt |
| Bis zur Prüfung ausblenden (`HIDE`) | aktiv, pausiert, abgelaufen | `PENDING_REVIEW` | in Bearbeitung |
| Freigeben (`RESTORE`) | `REJECTED`, `PENDING_REVIEW` | vorheriger Status (pausiert bleibt pausiert, abgelaufen bleibt abgelaufen) | ohne Maßnahme geschlossen |
| Konto sperren | aktiv | `SUSPENDED` | erledigt (wenn angegeben) |
| Sperre aufheben (nur Admin) | gesperrt | aktiv | – |

- Einschränkende Maßnahmen brauchen Art des Verstoßes, Rechtsgrundlage (Nutzungsbedingungen oder mutmaßlich
  rechtswidrig) und eine Begründung für die betroffene Person (mindestens 20 Zeichen). Eine interne Notiz ist optional
  und nur für das Team sichtbar.
- Jede Entscheidung speichert einen Schnappschuss des Inserats (Titel, Beschreibung, Preis, Kategorie, Status davor),
  damit sie auch nach späteren Änderungen nachvollziehbar bleibt.
- **Gleichzeitige Bearbeitung:** Das Formular schickt den Stand (`updatedAt`) mit, den die Moderation gesehen hat. Die
  API sperrt die Zeile und lehnt Entscheidungen auf veraltetem Stand ab (409). Statuswechsel durch die Anbieter
  (pausieren, fortsetzen, verlängern) prüfen den Ausgangsstatus atomar und überschreiben keine Moderationsentscheidung.
- Nicht freigegebene Inserate verschwinden sofort aus Meilisearch, der Detailseite (404) und der Bildauslieferung
  (nur noch signierte URLs für Eigentümer und Team). Dasselbe gilt für alle Inserate gesperrter oder gelöschter Konten.
- Eigene Inserate kann niemand aus dem Team selbst moderieren.
- **Erneut einreichen:** Ein deaktiviertes Inserat kann nach einer Überarbeitung wieder zur Prüfung eingereicht werden
  (`PENDING_REVIEW`). Veröffentlichen oder Fortsetzen ist für `REJECTED`/`PENDING_REVIEW` gesperrt.

### Gesperrte Konten

Eine gesperrte Person kann sich anmelden, erreicht aber nur: Kontostatus, ihre Entscheidungen samt Einspruch,
Mitteilungen, Datenexport und Kontolöschung (`@AllowSuspended()`). Alles andere liefert 403; auf öffentlichen Seiten
wird sie wie ein Gast behandelt. Ihre Inserate sind nicht mehr öffentlich, neue Nachrichten an sie sind nicht möglich.

## Einsprüche (Art. 20 DSA)

- Gegen jede einschränkende Entscheidung ist innerhalb von 183 Tagen ein Einspruch möglich (einer je Entscheidung).
- Prüfen darf nicht die betroffene Person selbst. Die ursprünglich entscheidende Person nur, wenn sie Admin ist – das
  wird im Audit-Log vermerkt (`sameReviewer`). Einsprüche von Team-Konten entscheiden nur Admins.
- „Stattgeben“ hebt die Entscheidung auf (neue Entscheidung `LISTING_RESTORED` bzw. `ACCOUNT_RESTORED`, die auf die
  aufgehobene verweist) – aber nur, wenn sich der Zustand inzwischen nicht anders geändert hat.
- Die Antwort geht per Mitteilung und E-Mail an die Person, mit Hinweis auf außergerichtliche Streitbeilegung (Art. 21).

## Mitteilungen

Tabelle `notifications`, sichtbar unter `/konto/mitteilungen`, zusätzlich als E-Mail (BullMQ-Auftrag
`notification-email`). Typen: Inserat deaktiviert, ausgeblendet oder freigegeben, Konto gesperrt oder entsperrt,
Einspruch entschieden, Meldung bearbeitet. Diese E-Mails sind Pflichtinformationen und lassen sich nicht abbestellen.

## Private Nachrichten

Das Team kann Nachrichten **nicht** pauschal lesen. Einzige Ausnahme: zu einer gemeldeten Unterhaltung, solange die
Meldung offen ist (oder ein Einspruch zur zugehörigen Entscheidung läuft). Auch dann:

- erst nach einer ausdrücklichen Bestätigung auf einer eigenen Seite,
- nur Nachrichten bis zum Zeitpunkt der Meldung, höchstens die letzten 100,
- jeder Abruf steht im Verlauf der Meldung und im Audit-Log (`report.messages_viewed`, ohne Nachrichteninhalt).

## Admin-Bereich

`/admin` – Übersicht (Warteschlangen, Inseratsstatus; für Admins zusätzlich Konten, Registrierungen der letzten 14
Tage, Hintergrundaufträge mit Fehlern, Löschaufträge und wichtige Ereignisse), `/admin/meldungen`, `/admin/inserate`,
`/admin/einsprueche`, `/admin/nutzer` (Admin), `/admin/protokoll` (Admin). Filter stehen in der URL. Tabellen werden
auf schmalen Bildschirmen zu Karten.

## Audit-Log

Alle Entscheidungen, Statusänderungen von Meldungen, Einsprüche, Rollenänderungen, Einschränkungen, Nachrichten-
einsicht, Datenexporte, Löschaufträge und Aufbewahrungsläufe werden protokolliert – mit Person, gekürzter IP und
Metadaten ohne Nachrichteninhalte, Passwörter oder Tokens. Fehlermeldungen von Hintergrundaufträgen werden vor der
Anzeige gekürzt und E-Mail-Adressen darin maskiert.

## Offene Punkte für die Rechtsprüfung

- Ob die Meldestelle für Personen **ohne Konto** erreichbar sein muss (Art. 16 DSA: „jeder Person“). Derzeit nur mit
  Anmeldung bzw. über eine Kontaktadresse auf `/melden`.
- Ob meldende Personen gegen die Ablehnung ihrer Meldung Einspruch erheben können müssen (Art. 20 DSA). Derzeit
  bekommen sie eine Mitteilung, aber kein Einspruchsformular.
- Ausnahmen für Kleinst- und Kleinunternehmen (Art. 19 DSA) und welche Pflichten (Transparenzberichte nach Art. 15/24,
  Übermittlung von Entscheidungsbegründungen an die DSA-Transparenzdatenbank nach Art. 24 Abs. 5) tatsächlich gelten.
- Formulierung der Begründungen (Art. 17), Nennung der Rechtsgrundlage bei mutmaßlich rechtswidrigen Inhalten und
  Meldung an Behörden bei Verdacht auf Straftaten (Art. 18).
- Fristen: Einspruchsfrist 6 Monate, Aufbewahrung von Entscheidungen und Meldungen (siehe [Datenschutz](datenschutz.md)).
- Regeln für verbotene Artikel (Waffen, Arzneimittel, Tiere, Markenfälschungen) in den Nutzungsbedingungen.
- KoPl-G / Zuständigkeit der KommAustria als Koordinator für digitale Dienste.
