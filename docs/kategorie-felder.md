# Kategorieabhängige Inseratsfelder

Stand: Phase 3. Je nach gewählter **Unterkategorie** fragt das Inseratsformular passende Zusatzangaben ab
(Kilometerstand beim Gebrauchtwagen, Wohnfläche bei der Mietwohnung, Gehalt beim Job …).

## Wo was liegt

| Teil | Ort |
| --- | --- |
| Felddefinitionen je Kategorie | `packages/shared/src/attributes/definitions.ts` |
| Auswahllisten (Marken, Kraftstoff, Ausstattung …) | `packages/shared/src/attributes/options.ts` |
| Prüfung, Übernahme bei Kategoriewechsel, Formular lesen | `packages/shared/src/attributes/validation.ts` |
| Darstellung (Detailseite, Kurzinfos auf Karten, Preiszusatz) | `packages/shared/src/attributes/format.ts` |
| Serverseitige Durchsetzung | `apps/api/src/listings/listings.service.ts` |
| Formularfelder | `apps/web/src/components/listing-form/attribute-fields.tsx` |

Gespeichert wird in der bestehenden Spalte `listings.attributes` (JSON). Es war **keine Datenbankmigration** nötig.
Die Definitionen liegen im Code statt in `categories.attribute_schema`, damit Web und API garantiert dieselben
Regeln verwenden und sie typgeprüft und getestet sind. Zugeordnet wird über `categories.path`
(z. B. `immobilien/wohnungen/mietwohnungen`); speziellere Pfade überschreiben allgemeinere.

## Felder

| Bereich | Unterkategorie | Pflicht beim Veröffentlichen | Optional |
| --- | --- | --- | --- |
| Auto & Motor | Gebrauchtwagen | Marke, Modell, Erstzulassung (Jahr), Kilometerstand, Kraftstoff, Getriebe, Fahrzeugzustand | Monat der Erstzulassung, Leistung (kW, Anzeige auch in PS) |
| | Neuwagen | Marke, Modell, Kraftstoff, Getriebe, Fahrzeugzustand | Erstzulassung, Kilometerstand, Leistung |
| | Motorräder | Marke, Modell, Erstzulassung, Kilometerstand, Fahrzeugzustand | Hubraum, Leistung, Kraftstoff, Getriebe |
| | Wohnmobile & Wohnwagen | Fahrzeugart, Erstzulassung, Fahrzeugzustand | Marke, Modell, Kilometerstand, Schlafplätze, Kraftstoff, Getriebe, Leistung |
| | Nutzfahrzeuge | Fahrzeugart, Erstzulassung, Fahrzeugzustand | Marke, Modell, Kilometerstand, Kraftstoff, Getriebe, Leistung |
| | Fahrzeugzubehör | – (Artikelzustand wie im Marktplatz) | Reifen & Felgen: Reifenart, Reifengröße, Felgengröße, Stückzahl |
| Immobilien | Miet-/Eigentumswohnungen | Wohnfläche, Zimmer | Stockwerk, Baujahr, Betriebskosten, Heizung, Ausstattung, HWB, fGEE |
| | Häuser mieten/kaufen | Wohnfläche, Zimmer | Grundstücksfläche, Baujahr, Betriebskosten, Heizung, Ausstattung, HWB, fGEE |
| | Gewerbeimmobilien | Art der Immobilie, Nutzfläche | Stockwerk, Baujahr, Betriebskosten, Heizung, Ausstattung, HWB, fGEE |
| | Grundstücke | Angebotsart (Kauf/Miete), Grundstücksfläche | Widmung |
| | Garagen & Parkplätze | Angebotsart, Art | Lademöglichkeit für E-Autos |
| Jobs | Vollzeit | Berufsbezeichnung, Beschäftigungsart, Arbeitsort, Gehalt + Zeitraum | Arbeitszeit, Arbeitszeitmodell, Überzahlung, Berufserfahrung |
| | Teilzeit | wie Vollzeit, zusätzlich Arbeitszeit | |
| | Lehrstellen, Praktika, Geringfügig | Berufsbezeichnung, Arbeitsort, Gehalt + Zeitraum (Geringfügig: auch Arbeitszeit) | Lehrzeit bzw. Dauer, Arbeitszeit |
| | Freelance | Berufsbezeichnung, Beschäftigungsart, Arbeitsort | Honorar + Zeitraum, Arbeitszeit, Berufserfahrung |
| Marktplatz | Handys, Computer, Tablets, TV, Konsolen | – | Marke, Speicher, Arbeitsspeicher, Bildschirmdiagonale, Plattform |
| | Möbel & Wohnen | – | Breite, Tiefe, Höhe |
| | Damen-/Herrenmode, Schuhe, Kinderkleidung | – | Größe, Marke |
| | Fahrräder | – | Art, Rahmengröße, Laufradgröße |
| | Dienstleistungen | – (kein Artikelzustand) | Preis gilt pro Stunde/Tag/pauschal |

Besonderheiten:
- **Kaufen oder Mieten** ergibt sich bei Wohnungen, Häusern und Gewerbeimmobilien aus der Kategorie und ist
  nicht änderbar. Bei Miete heißt das Preisfeld „Miete pro Monat“, Anzeige „€ 950 pro Monat“.
- **Jobs haben keinen Preis.** Statt des Preises zeigen Karten und Detailseite das Gehalt
  („€ 2.400 brutto pro Monat, Überzahlung möglich“). Österreichische Stellenanzeigen müssen das Mindestentgelt
  nennen, daher ist das Gehalt bei Anstellungen Pflicht.
- **HWB/fGEE**: Liegt ein Energieausweis vor, sind die Werte in Immobilienanzeigen anzugeben (Energieausweis-Vorlage-Gesetz).
  Die Felder sind optional, weil nicht jedes Objekt einen Energieausweis hat.
- Der allgemeine **Artikelzustand** (Neu, Gut …) erscheint nur bei Waren, nicht bei Autos, Immobilien, Jobs,
  Dienstleistungen und Tickets. Fahrzeuge haben stattdessen „Fahrzeugzustand“.
- Zahlen dürfen österreichisch eingegeben werden: „85.000“, „72,5“, „1.299,90“.

## Regeln in der API

- **Entwürfe** dürfen unvollständig sein, eingegebene Werte werden aber trotzdem geprüft (Typ, Bereich, Auswahlliste).
- **Veröffentlichen** (sofort, später oder beim Verlängern) verlangt alle Pflichtangaben der Kategorie. Fehlende Angaben
  werden zusammen mit den übrigen Feldfehlern gemeldet, z. B. „Bitte gib „Kilometerstand“ an.“
- **Bearbeiten**: Übermittelte `attributes` ersetzen die gespeicherten vollständig. Aktive und pausierte Inserate müssen
  danach vollständig bleiben.
- **Kategoriewechsel** ohne neue Angaben: Nur Werte, die es in der neuen Kategorie gibt und die dort gültig sind, bleiben
  erhalten (Mietwohnung → Eigentumswohnung behält Fläche und Zimmer; Auto → Wohnung verwirft alles). Ein Artikelzustand
  wird entfernt, wenn die neue Kategorie keinen kennt.
- **Manipulierte Anfragen** (fremde Felder, falsche Typen, Werte außerhalb des Bereichs, andere Angebotsart als die
  Kategorie, Zustand bei Autos, Preis bei Jobs) werden mit 400 und deutscher Meldung je Feld abgewiesen bzw. beim Preis
  von Jobs ignoriert. Es wird dann nichts gespeichert.
- **Formular**: Es werden nur die Felder der aktuell gewählten Kategorie abgeschickt. Wechselt man die Kategorie und
  wieder zurück, sind die Eingaben im Browser noch da, gespeichert werden aber nie Werte einer anderen Kategorie.

## Bestehende Anzeigen

Anzeigen aus Phase 1/2 haben leere Zusatzangaben. Sie bleiben sichtbar, auffindbar, pausier- und löschbar.
Wer eine solche Auto-, Immobilien- oder Job-Anzeige **bearbeitet oder verlängert**, muss die Pflichtangaben der Kategorie
ergänzen; das Formular zeigt die fehlenden Felder an. Gespeicherte Werte, die es nicht (mehr) gibt, werden weder
angezeigt noch beim nächsten Speichern übernommen.

## Neue Felder ergänzen

1. Feld in `definitions.ts` bei der passenden Kategorie eintragen (Schlüssel nie nachträglich umbenennen).
2. Bei Auswahlfeldern die Liste in `options.ts` ergänzen; gespeicherte Werte nicht umbenennen.
3. `pnpm --filter @marktat/shared test` und `pnpm --filter @marktat/api test` prüfen u. a., dass jede Regel auf eine
   existierende Kategorie zeigt und die Demo-Inserate gültig sind.
