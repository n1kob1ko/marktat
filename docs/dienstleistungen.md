# Dienstleistungen und Anbieterprofile

Phase 10, Schritt 3. Freelancer:innen, Handwerksbetriebe und Privatpersonen bieten Dienstleistungen an. Kund:innen finden sie unter `/dienstleistungen` und schreiben ihnen über die bestehenden Nachrichten. MarktAT vermittelt nur den Kontakt: keine Provision, keine Zahlung, keine Buchung.

## Ein Konto, keine zweite Registrierung

Das Anbieterprofil ist eine **Erweiterung des bestehenden Kontos** (eine Zeile `service_profiles` je Konto, `user_id` eindeutig). Name, Konto-Art (privat/gewerblich), Firmenangaben und Logo kommen aus dem Konto. Angelegt und bearbeitet wird es unter `/konto/dienstleistungen`.

Gewerbliche Konten brauchen zum Veröffentlichen Firmenname und Firmenanschrift im Konto. Sie erscheinen als Impressum auf der Profilseite (§ 5 ECG, Art. 30 DSA).

## Datenmodell

| Tabelle | Zweck |
| --- | --- |
| `service_categories` | 26 Kategorien in 5 Bereichen (Seed aus `packages/shared/src/services/categories.ts`). `regulated` markiert Tätigkeiten, für die eine Gewerbeberechtigung nötig sein kann. `related_category_path` verweist auf Marktplatz › Dienstleistungen bzw. Jobs › Freelance, damit es keine doppelte Kategorielogik gibt. |
| `service_profiles` | Überschrift, Kurz- und Langbeschreibung, Fähigkeiten, Ort mit Einsatzradius, österreichweit/remote, Preisart (Stundensatz, pauschal ab, auf Anfrage), Erfahrung, Website, Verfügbarkeit, Profilbild mit Bildrechten, Status, Zähler |
| `service_profile_categories` | 1 bis 5 Kategorien je Profil |
| `service_portfolio_items` | Bis zu 12 Arbeitsproben mit Titel, Beschreibung, Link, Bild mit Bildrechten. `hidden_at`: von der Moderation ausgeblendet. |
| `service_qualifications` | Bis zu 5 Qualifikationen: Angabe der Anbieter:in, Status `CLAIMED`/`VERIFIED`/`REJECTED`, Prüfung mit Datum, Prüfer:in und interner Notiz |

Neue Spalten: `conversations.service_profile_id`, `reports.service_profile_id`, `moderation_decisions.service_profile_id`. Eine Unterhaltung hat jetzt genau einen Gegenstand, Inserat **oder** Anbieterprofil (CHECK-Constraint). Bestehende Unterhaltungen behalten ihr Inserat. Fremdschlüssel sind `RESTRICT`, wie bisher beim Inserat. Gelöschte Profile bleiben deshalb als Zeile mit Status `DELETED` erhalten, ohne Inhalte und Bilder.

Die Migrationen `20261101090000_service_profiles`, `20261101090100_service_profiles_restrict` und `20261101090200_qualification_review` fügen nur Tabellen, Spalten, Enum-Werte und Constraints hinzu. Bestehende Daten bleiben unverändert.

## Status

`DRAFT` → (Bestätigung) → `ACTIVE` ⇄ `PAUSED`. Die Moderation kann `REJECTED` setzen (Ablehnen) oder `PENDING_REVIEW` (bis zur Prüfung ausblenden). Ein abgelehntes Profil kann nach einer Überarbeitung erneut eingereicht werden. Löschen setzt `DELETED` und entfernt Portfolio, Qualifikationen und Bilder; ein neues Profil beginnt wieder als Entwurf.

Öffentlich sichtbar ist ein Profil nur, wenn es `ACTIVE` ist und das Konto aktiv und nicht gelöscht ist (`publicServiceProfileWhere`). Ein gesperrtes Konto verschwindet also auch hier.

## Suche

Nur Postgres/PostGIS, kein eigener Meilisearch-Index (wenige Profile, viele Ortsregeln).

- **Begriff**: Überschrift, Kurzbeschreibung, Beschreibung, Fähigkeiten, Name
- **Bereich, Kategorie**: `bereich=handwerk-haus`, `kategorie=elektriker`
- **Ort und Umkreis**: `plz=8010&umkreis=25` bzw. `ort=<id>`. Ein Profil passt, wenn es österreichweit arbeitet, die PLZ gleich ist oder der Abstand höchstens `max(Umkreis der Suche, Einsatzradius des Profils)` beträgt. Remote-Profile ohne passenden Ort erscheinen bei einer Ortssuche nicht. Mit dem Filter „remote“ schränkt der Ort nicht ein, er bestimmt dann nur die Entfernung.
- **remote**, **verfuegbar** (nur „verfügbar“), **preis_bis** (Euro, nur Stundensatz/pauschal), **anbieter=privat|gewerblich**
- Sortierung: Relevanz, neueste, Preis aufsteigend, Entfernung

Ungültige Parameter liefern 400 mit Liste der Fehler. Die Web-Seite zeigt sie als Hinweis.

## Kontakt

`POST /v1/services/:id/conversations` öffnet eine Unterhaltung über die bestehenden Nachrichten. Es gelten dieselben Regeln: Blockieren, Melden von Nachrichten, Rate-Limits, E-Mail-Hinweis mit Verzögerung, Echtzeit über SSE. Das eigene Profil kann man nicht anschreiben. Pausierte oder abgelehnte Profile nehmen keine neuen Anfragen an; bestehende Unterhaltungen bleiben lesbar.

## Qualifikationen und regulierte Berufe

- Qualifikationen sind zunächst **„Angabe der Anbieter:in, nicht geprüft“**. Die Nummer (z. B. GISA-Zahl) ist erst nach der Prüfung öffentlich.
- **„Von MarktAT geprüft“** setzt nur das Team unter `/admin/dienstleistungen/:id`, nach Abgleich mit einer verlässlichen Quelle (GISA, Kammer, Berufsregister). Die Prüfung wird protokolliert (`admin.qualification_verified/rejected`), die Anbieter:in bekommt eine Mitteilung (`QUALIFICATION_REVIEWED`). Eigene Qualifikationen kann niemand selbst prüfen.
- Profile mit regulierten Kategorien zeigen einen Hinweis mit Link zur GISA-Abfrage. MarktAT prüft Gewerbeberechtigungen **nicht** automatisch, und es gibt keine Schnittstelle zum GISA.
- Bewertungen, Sterne, Abzeichen und „Top-Anbieter“ gibt es bewusst nicht.

## Bilder

Profilbild und Portfolio-Bilder laufen über die bestehende Bildverarbeitung (Prüfung, Verkleinerung, EXIF/GPS entfernen). Die Herkunft ist Pflicht: eigene Arbeit, Arbeit für Kund:innen mit Erlaubnis oder lizenziert (mit Quelle). Ohne eigenes Bild zeigt ein öffentliches gewerbliches Profil das Firmenlogo. Die Web-App leitet Uploads über `/api/medien/dienstleistungen` und `/api/medien/dienstleistungen/portfolio/:id` an die API weiter (gleiche Herkunft, Anmeldung, Typ- und Größenprüfung).

## Moderation

- Melden: `/melden?anbieter=<id>` (Art. 16 DSA, eine offene Meldung je Person und Profil)
- Entscheidungen über Profile: Ablehnen, bis zur Prüfung ausblenden, Freigeben, mit Begründung nach Art. 17 DSA, Versionsprüfung und Einspruch
- Einzelne Portfolio-Einträge ausblenden bzw. wieder zeigen (z. B. fremdes Bild ohne Nutzungsrecht). Das Profil bleibt dabei sichtbar.
- Admin-Liste `/admin/dienstleistungen` mit Filtern: in Prüfung/gemeldet/Qualifikation offen, gemeldet, Qualifikationen, Status. Die E-Mail-Adresse sehen nur Administrator:innen.
- Alle Schritte stehen im Audit-Log (`service_profile.*`, `moderation.service_profile_*`, `moderation.portfolio_item_*`).

## Merkliste und gespeicherte Suchen

Anbieterprofile lassen sich merken und als Suche speichern, mit höchstens einer Sammel-E-Mail am Tag. Details stehen in [nachrichten.md](nachrichten.md#deals-und-anbieterprofile-phase-10).

## Navigation

Unter dem Kopf steht auf jeder Seite die Bereichsleiste mit sechs Bereichen: Marktplatz, Auto & Motor, Immobilien, Jobs, Deals und Dienstleistungen (`components/area-nav.tsx`). Die vier Kleinanzeigen-Bereiche verlinken wie bisher auf `/suche?bereich=…`, alte Adressen bleiben gültig. Auf dem Smartphone lässt sich die Leiste seitlich wischen, die Seite selbst scrollt nicht seitlich.

## Datenschutz

Datenexport (Art. 15/20 DSGVO) enthält Profil, Portfolio, Qualifikationen, Unterhaltungen zum Profil sowie gemerkte Deals und Anbieter. Beim Löschen des Kontos werden Profil, Portfolio, Qualifikationen und alle Bilder entfernt.

## Projektaufträge

Unter `/dienstleistungen/projekte` beschreiben Privatpersonen und Betriebe ein konkretes Vorhaben (z. B. „Website umziehen“, „Stiegenhaus ausmalen“), für das sie eine selbstständige Dienstleistung suchen. Abgrenzung:

| | Projektauftrag | Jobs (Inserat) | Anbieterprofil |
|---|---|---|---|
| Wer veröffentlicht | wer etwas erledigt haben will | Arbeitgeber:in | wer Leistungen anbietet |
| Worum es geht | einmaliges Vorhaben, selbstständige Leistung | Anstellung | dauerhaftes Angebot |
| Wer antwortet | nur Anbieter:innen mit sichtbarem Profil | alle | Kund:innen |

**Keine Ausschreibung:** keine Gebote, keine öffentlichen Angebote, keine Vergabe und keine Zahlungen über MarktAT. Antworten laufen über die bestehenden Nachrichten (`conversations.project_id`, genau ein Bezug je Unterhaltung per CHECK-Constraint).

- **Lebenszyklus**: Entwurf → Veröffentlichen mit Bestätigung („selbstständige Leistung, kein Arbeitsverhältnis“) → sichtbar für 30 Tage → Verlängern in den letzten 7 Tagen bzw. nach Ablauf → Pausieren / Fortsetzen / Beenden („jemand gefunden“) / Löschen (Status `DELETED`, bestehende Unterhaltungen bleiben lesbar).
- **Schutz vor Flut und Spam**: höchstens 5 offene Aufträge je Konto, 50 insgesamt; höchstens 20 Anbieter:innen je Auftrag (Zählung unter Zeilensperre, gleichzeitige Anfragen überschreiten das nicht); Anlegen 10/Stunde; Blockieren wie bei allen Nachrichten.
- **Felder**: Titel, Beschreibung, eine Kategorie (dieselben 5 Bereiche wie bei Profilen), Ort und/oder remote, Budget (Pauschal, Stundensatz bis, offen), Zeitraum (Freitext). Öffentlich nur PLZ und Ort.
- **Suche** (PostgreSQL/PostGIS): Begriff, Bereich, Kategorie, PLZ bzw. Ort mit Umkreis, „nur remote“ (dann schränkt der Ort nicht ein), Sortierung nach Datum oder Entfernung. Abgelaufene, pausierte und Aufträge gesperrter Konten erscheinen nicht.
- **Konto**: `/konto/projekte` (Liste mit Zahl der Anfragen) und `/konto/projekte/<id>` (Bearbeiten, Status, Löschen).
- **Melden und Moderation**: `/melden?projekt=<id>`; Admin unter `/admin/dienstleistungen/projekte` (Deaktivieren, bis zur Prüfung ausblenden, Freigeben, mit Begründung, Versionsprüfung und Einspruch). Abgelehnte Aufträge können nach einer Überarbeitung erneut eingereicht werden. Audit-Log: `project.*`, `moderation.project_*`.
- **API**: `GET /v1/projects`, `GET /v1/projects/:id`, `POST /v1/projects/:id/conversations`, `POST /v1/projects/:id/report`, `/v1/me/projects…`, `/v1/admin/projects…` (siehe Swagger).
- **Datenschutz**: Export enthält eigene Aufträge und Unterhaltungen dazu; beim Löschen des Kontos werden Aufträge und deren Unterhaltungen entfernt.

## Offene Rechtsfragen (vor dem Start klären)

- **Gewerberecht**: Privatpersonen dürfen nur Tätigkeiten anbieten, für die keine Gewerbeberechtigung nötig ist (Nachbarschaftshilfe, gelegentliche Tätigkeiten). Wo die Grenze liegt, sollte eine Fachperson für Gewerberecht in den Nutzungsbedingungen formulieren.
- **Regulierte Berufe** (z. B. Elektrotechnik, Gas/Wasser, Buchhaltung, Rechts- und Steuerberatung): Reicht der GISA-Hinweis, oder sollen manche Kategorien nur gewerblichen Konten mit geprüfter Berechtigung offenstehen?
- **Impressum (§ 5 ECG)** für gewerbliche Profile: Reichen Firmenname, Anschrift, Firmenbuchnummer und UID aus dem Konto, oder sind Kammer/Aufsichtsbehörde zusätzlich nötig?
- **Plattformarbeit**: Die EU-Plattformarbeitsrichtlinie betrifft Plattformen, die Arbeit organisieren. MarktAT vermittelt nur Kontakte und setzt keine Preise oder Aufträge fest; das sollte vor dem Start bestätigt werden.
- **Haftung für Angaben**: Text zu „nicht geprüft“ und „Von MarktAT geprüft“ in den Nutzungsbedingungen.
- **Scheinselbstständigkeit**: Projektaufträge sind für selbstständige Leistungen gedacht. Ob die Bestätigung beim Veröffentlichen und das Melden versteckter Arbeitsverhältnisse ausreichen oder zusätzliche Hinweise (z. B. zur Sozialversicherung) nötig sind, sollte eine Fachperson für Arbeitsrecht beurteilen.
