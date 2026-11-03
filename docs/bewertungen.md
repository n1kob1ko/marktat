# Bewertungen

Nach einem Kontakt zu einer **Anzeige** können sich beide Seiten gegenseitig mit 1–5 Sternen und optional einem kurzen Text (max. 500 Zeichen) bewerten. Dienstleistungen und Projektaufträge haben bewusst keine Bewertungen (siehe `dienstleistungen.md`).

## Regeln

- Bewerten kann nur, wer an der Unterhaltung beteiligt ist, und erst wenn **beide** mindestens eine Nachricht geschrieben haben.
- Je Unterhaltung und Person genau eine Bewertung (`ratings_conversation_id_rater_id_key`); sie kann geändert oder gelöscht werden.
- Höchstens 20 neue Bewertungen je Konto und Tag (`RATINGS_PER_DAY`), Administratorkonten ausgenommen.
- Ob tatsächlich gekauft wurde, prüft Markterl nicht. Das steht offen auf allen Bewertungsseiten (Transparenz zu Verbraucherbewertungen, UWG/Omnibus-Richtlinie).
- Die bewertete Person kann einmal öffentlich antworten (änderbar, entfernbar) und Bewertungen melden.
- Bewertungen werden mit der Unterhaltung gelöscht, also auch wenn eines der beiden Konten gelöscht wird. Sie sind im Datenexport enthalten (`ratingsGiven`, `ratingsReceived`).
- Neue Bewertung: Mitteilung `RATING_RECEIVED` im Konto, per E-Mail nur mit eingeschalteter Einstellung „E-Mail bei neuen Nachrichten“.

## Anzeige

- Anzeigenseite und Händlerprofil: Sterne, Durchschnitt und Anzahl (`GET /v1/users/:id/rating-summary`).
- Öffentliche Seite `/bewertungen/:userId` mit Verteilung und allen sichtbaren Bewertungen (`GET /v1/users/:id/ratings`). Profile gesperrter oder gelöschter Konten gibt es nicht (404).
- Chat: Knopf „Bewerten“ im Kopf, sobald bewerten möglich ist; Formular unter `/bewerten/:conversationId`.
- Konto › Bewertungen: erhaltene (mit Antwort) und abgegebene Bewertungen (`GET /v1/me/ratings`).

## Moderation

- Melden: `/melden?bewertung=<id>` bzw. `POST /v1/ratings/:id/report` (Art. 16 DSA, Meldeart `RATING`).
- Im Admin-Bereich unter der Meldung: „Bewertung ausblenden“ (`RATING_HIDDEN`, mit Grund, Rechtsgrundlage und Begründung) oder „Wieder zeigen“ (`RATING_RESTORED`), `POST /v1/admin/ratings/:id/decisions`.
- Betroffen ist die Person, die die Bewertung geschrieben hat: sie bekommt die Begründung und kann Einspruch erheben. Wird dem Einspruch stattgegeben, ist die Bewertung wieder sichtbar.
- Ausgeblendete Bewertungen zählen nicht zum Durchschnitt und können nicht mehr geändert, nur gelöscht werden.
