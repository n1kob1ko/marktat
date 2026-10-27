# Datenschutz: Export, Kontolöschung und Aufbewahrung (Phase 6)

> ⚠️ Technische Umsetzung, keine Rechtsberatung. Fristen und Texte vor dem Livebetrieb von einer österreichischen
> Rechtsberatung bzw. Datenschutzfachleuten prüfen lassen.

## Datenexport (Art. 15 und 20 DSGVO)

`/konto/datenschutz` → „Datenexport herunterladen“ (Route `GET /v1/me/export`, höchstens 5-mal je Stunde, auch für
gesperrte Konten). Die JSON-Datei enthält:

| Bereich | Inhalt |
| --- | --- |
| `profile`, `settings` | Profil- und Firmenangaben, Rolle, Status, AGB-Version, E-Mail-Einstellungen |
| `listings` | Alle eigenen Inserate (auch Entwürfe, deaktivierte, gelöschte) mit Kategorie, Ort, Zusatzangaben und Bild-Metadaten |
| `favorites`, `savedSearches` | Merkliste und gespeicherte Suchen |
| `conversations` | Je Unterhaltung: Inserat, eigene Rolle (Interessent/Anbieter), Anzeigename des Gegenübers, **nur die eigenen Nachrichten**, Anzahl erhaltener Nachrichten |
| `blockedPersons` | Von dir blockierte Konten (Anzeigename) |
| `reportsMade` | Eigene Meldungen mit Grund, Text und Status – ohne Angaben zur gemeldeten Person |
| `moderationDecisions` | Entscheidungen über dich bzw. deine Inserate mit Begründung und Einspruch (ohne interne Notizen und Namen aus dem Team) |
| `notifications`, `activity` | Mitteilungen und das eigene Aktivitätsprotokoll (Aktion, Zeitpunkt, gekürzte IP) |
| `bookings` | Gebuchte Leistungen (Phase 7) mit Preis zum Buchungszeitpunkt, Laufzeit und ggf. Zahlungsstatus; im Profil zusätzlich Website, Telefon-Freigabe und ob ein Logo hinterlegt ist |

Nicht enthalten: Nachrichten und Profildaten anderer Personen, Meldungen anderer über dich, interne Notizen.
Bilddateien selbst sind nicht im Export (nur ihre Metadaten); sie können über die Inserate heruntergeladen werden.

## Kontolöschung (Art. 17 DSGVO)

`/konto/datenschutz` → „Konto löschen …“ → Passwort und das Wort `LÖSCHEN`. Ablauf:

1. **Erneute Anmeldung:** Die API prüft das Passwort direkt bei Supabase Auth. Höchstens 5 Fehlversuche je Konto und
   Stunde (aus dem Audit-Log gezählt, gilt über alle Instanzen), zusätzlich 10 Anfragen je Stunde.
2. **Sofort, in einer Transaktion:** Konto auf `DELETED` und Löschauftrag (`account_deletions`) anlegen. Ab hier ist
   das Konto für alle Anfragen gesperrt (403), alle Inserate sind unsichtbar, die Suche wird aktualisiert. Das letzte
   aktive Administratorkonto kann nicht gelöscht werden.
3. **Abmelden:** Alle Sitzungen bei Supabase Auth werden beendet, das Web-Cookie entfernt.
4. **Hintergrundauftrag** `account-deletion` (BullMQ, Wiederholungen mit Backoff) arbeitet die Schritte ab und merkt
   sich erledigte Schritte (`completed_steps`), damit ein Neustart dort weitermacht:
   - `auth` – Konto in Supabase Auth löschen (404 gilt als erledigt),
   - `jobs` – wartende E-Mails zu Unterhaltungen und Mitteilungen der Person abbrechen,
   - `search` – Inserate aus Meilisearch entfernen,
   - `images` – alle Bildvarianten und Rohdateien in R2 bzw. im lokalen Speicher sowie das Firmenlogo löschen,
   - `data` – in **einer** Transaktion: Unterhaltungen mit allen Nachrichten (beider Seiten), Merkliste, gespeicherte
     Suchen, Blockierungen, Mitteilungen, kostenlose Buchungen und Inserate löschen (bezahlte Buchungen samt Zahlung bleiben für die Buchhaltung, ohne Verweis auf Inserat und mit anonymisiertem Konto); eigene Meldungen behalten, aber ohne Verweis auf die
     meldende Person; Profil zu einem Platzhalter ohne Namen, E-Mail und Kontaktdaten anonymisieren.
5. **Fehler:** Jeder Fehlversuch wird gespeichert (`last_error`, E-Mail-Adressen maskiert). Nach 5 Versuchen steht der
   Auftrag auf `FAILED`, erscheint im Admin-Dashboard und kann im Konto unter `/admin/nutzer/<id>` neu gestartet
   werden. Ein Aufräumauftrag (`account-deletion-sweep`, alle 10 Minuten) stößt hängengebliebene Aufträge wieder an.

Weil das Konto schon in Schritt 2 gesperrt und unsichtbar ist, entsteht bei einem Teilfehler kein Zustand, in dem
Daten öffentlich sichtbar oder das Konto nutzbar wären; offen sind dann nur noch Löschschritte, die wiederholt werden.

## Aufbewahrung und Löschfristen

Der Auftrag `retention-cleanup` läuft täglich (`apps/api/src/privacy/retention.ts`). Vorschläge, rechtlich zu prüfen:

| Daten | Frist | Begründung |
| --- | --- | --- |
| Gelesene Mitteilungen | 180 Tage | Nur Information, liegt zusätzlich als E-Mail vor |
| Alle Mitteilungen | 365 Tage | wie oben |
| Audit-Log | 365 Tage | Nachweis von Sicherheits- und Moderationsvorgängen, Missbrauchserkennung |
| Erledigte Meldungen samt Verlauf | 730 Tage ab Abschluss | Nachvollziehbarkeit, wiederholte Verstöße, Beschwerden |
| Moderationsentscheidungen und Einsprüche | 730 Tage, solange nicht mehr wirksam | Begründungspflicht, Einsprüche, Streitbeilegung (Art. 20/21 DSA); wirksame Sperren, deaktivierte Inserate und offene Einsprüche bleiben, solange sie gelten |
| Platzhalter gelöschter Konten | 730 Tage nach Abschluss der Löschung | Verweise aus Entscheidungen; danach werden Platzhalter samt Entscheidungen gelöscht |
| Schnappschuss des Inserats in einer Entscheidung | mit der Entscheidung | Titel und Beschreibung des moderierten Inhalts als Beleg |

Soft-gelöschte Inserate (vom Anbieter gelöscht, Konto besteht weiter) bleiben wie bisher in der Datenbank; eine Frist
für ihre endgültige Löschung ist noch festzulegen (siehe Risiken in [sicherheit.md](sicherheit.md)).

## Zugriff auf private Nachrichten

Siehe [Moderation](moderation.md#private-nachrichten): kein pauschaler Zugriff, nur zu einer offenen Meldung, nach
Bestätigung und protokolliert.
