# Geodaten (Bundesländer, Bezirke, PLZ)

## Was im Repo liegt

| Daten | Umfang | Quelle |
| --- | --- | --- |
| Bundesländer | alle 9 (AT-1 … AT-9) | `packages/shared/src/austria.ts` |
| Bezirke | 93 politische Bezirke + 23 Wiener Gemeindebezirke (901–923) | `apps/api/prisma/seed/districts.ts`, Kennziffern nach Statistik Austria |
| Orte/PLZ | **20.877 Orte, 2.461 Postleitzahlen** (vollständig) | `apps/api/prisma/seed/data/at-locations.tsv.gz` |

`pnpm db:seed` lädt das vollständige Verzeichnis ohne Internetzugang. Bestehende Orte werden über
PLZ + Ortsname aktualisiert, es wird nichts gelöscht. Inserate verweisen weiter auf ihre `location_id`.

Spalten der Datei: `postal_code`, `place`, `municipality` (Gemeinde, wenn sie anders heißt als der Ort),
`district_id`, `latitude`, `longitude`.

## Datenquelle und Lizenz

**GeoNames-Postleitzahlen für Österreich** (`https://download.geonames.org/export/zip/AT.zip`),
Lizenz **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)**. Pflicht ist die Namensnennung
„Postleitzahlen: GeoNames (geonames.org), CC BY 4.0“, z. B. im Impressum oder auf einer Quellenseite
(steht im Impressum, siehe [rechtliches.md](rechtliches.md)). Die Daten wurden aufbereitet (siehe unten); das ist nach CC BY erlaubt,
muss aber nicht eigens gekennzeichnet werden.

Verwendet wurde die inhaltsgleiche CSV-Umwandlung aus `zauberware/postal-codes-json-xml-csv`, weil geonames.org
aus der Entwicklungsumgebung nicht erreichbar war. Der Parser liest beide Formate (Original-`AT.txt` mit Tabulatoren
und die CSV mit Kopfzeile).

## Aufbereitung (`apps/api/prisma/seed/geonames.ts`)

- **Bezirk:** aus der 5-stelligen Gemeindekennziffer von Statistik Austria (erste drei Ziffern, z. B. 60101 → 601),
  in Wien aus dem Gemeindebezirk (901 … 923). Fehlt die Kennziffer, wird der Bezirk vom Ort mit derselben PLZ
  bzw. vom nächstgelegenen Ort im Bundesland übernommen.
- **Mehrere Orte je PLZ:** jede Ortschaft ist ein eigener Eintrag (z. B. 4020 Linz und 4020 Leonding). Gemeinden ohne
  gleichnamige Ortschaft (z. B. 9500 Villach) werden ergänzt, damit der Hauptort immer auffindbar ist.
- **Lesbare Namen:** „Wien, Neubau“ → „Wien“, „Graz,09.Bez.:Waltendorf“ → „Graz“, „Oberwart / Felsöör“ → „Oberwart“.
- **Duplikate:** gleiche PLZ + gleicher Name nach dem Vereinheitlichen werden zusammengeführt (278 Zeilen).
- **Postfächer** (40 Zeilen) sind keine Wohnorte und fallen weg.
- **Koordinaten-Prüfung:** Punkte außerhalb Österreichs oder mehr als 80 km vom Bezirk entfernt werden verworfen
  (aktuell keine). Ein Test (`geo-dataset.spec.ts`) prüft die Datei: alle Bundesländer und Bezirke abgedeckt, nur gültige
  PLZ und Koordinaten in Österreich, keine doppelten Einträge, Stichproben im richtigen Bundesland.
- **Wien:** GeoNames setzt fast alle Wiener PLZ auf den Stephansplatz. Für eine brauchbare Umkreissuche bekommt jede
  Wiener PLZ den Mittelpunkt ihres Gemeindebezirks (`VIENNA_DISTRICT_CENTRES`, ca. ±1 km).

### Ortssuche

`GET /v1/geo/locations?q=` findet nach PLZ-Anfang, Ortsname (auch „St.“/„Sankt“) und „PLZ Ort“. Hauptorte stehen
vorne: exakte Treffer, dann Gemeindehauptort, Statutarstadt und Haupt-PLZ (z. B. 1010 vor 1011 bei „Wien“).

## Verzeichnis aktualisieren

```bash
curl -LO https://download.geonames.org/export/zip/AT.zip && unzip AT.zip AT.txt
pnpm --filter @marktat/api geo:build --file AT.txt     # schreibt data/at-locations.tsv.gz neu (zum Committen)
pnpm db:seed                                           # oder direkt: geo:import --file AT.txt
pnpm --filter @marktat/api search:reindex              # neue Koordinaten in den Suchindex
```

`geo:build` gibt aus, wie viele Zeilen aus welchem Grund übersprungen wurden. Beide Skripte löschen nichts.

## Bekannte Einschränkungen

- GeoNames liefert pro Ortschaft einen Punkt (ca. 1–3 km genau), keine Gebietsflächen. Die Umkreissuche misst
  vom Ortspunkt des Inserats zum Ortspunkt der Suche.
- Außerhalb Wiens teilen sich mehrere Ortschaften einer PLZ teils dieselben Koordinaten.
- Großkunden- und Sonder-PLZ der Post (Firmen, Behörden) sind in GeoNames nicht enthalten. Für Inserate spielt das
  keine Rolle.
- Gemeindenamen und -zuordnungen sind so aktuell wie der GeoNames-Stand.

## Umkreissuche

`locations.geom` ist ein `geography(Point, 4326)` mit GiST-Index, `locations.place` hat einen Trigramm-Index für
die Ortssuche. Die Umkreissuche läuft in Meilisearch (`_geoRadius` auf `_geo`) und im PostgreSQL-Fallback mit
`ST_DWithin`. Details in [suche.md](suche.md).
