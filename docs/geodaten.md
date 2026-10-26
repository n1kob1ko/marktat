# Geodaten (Bundesländer, Bezirke, PLZ)

## Was im Repo liegt

| Daten | Umfang | Quelle |
| --- | --- | --- |
| Bundesländer | alle 9 (AT-1 … AT-9) | `packages/shared/src/austria.ts` |
| Bezirke | 93 politische Bezirke + 23 Wiener Gemeindebezirke (901–923) | `apps/api/prisma/seed/districts.ts`, Kennziffern nach Statistik Austria |
| Orte/PLZ | **140 ausgewählte Orte – ENTWICKLUNGSDATEN** | `apps/api/prisma/seed/locations.dev.ts` |

Die Entwicklungsorte decken alle Bundesländer und die größeren Städte ab. Die Koordinaten sind gerundete
Ortsmittelpunkte (ca. 1–3 km genau). Für den Echtbetrieb reicht das **nicht**: Nutzer würden ihre PLZ nicht finden.

## Vollständiges PLZ-Verzeichnis importieren

Empfohlene Quelle: GeoNames-Postleitzahlen für Österreich, Lizenz **CC BY 4.0**
(Namensnennung „GeoNames, geonames.org“ z. B. im Impressum oder auf einer Quellenseite nötig).

```bash
curl -LO https://download.geonames.org/export/zip/AT.zip
unzip AT.zip AT.txt
pnpm db:seed                                       # Bundesländer und Bezirke zuerst
pnpm --filter @marktat/api geo:import --file AT.txt
```

Das Skript (`apps/api/prisma/seed/geo-import.ts`) leitet den Bezirk aus der 5-stelligen Gemeindekennziffer ab
(erste drei Ziffern), aktualisiert bestehende Orte, löscht nichts und gibt am Ende aus, wie viele Zeilen aus welchem
Grund übersprungen wurden.

> **Ehrlicher Hinweis:** In der Entwicklungsumgebung, in der Phase 1 gebaut wurde, waren geonames.org und
> data.gv.at nicht erreichbar. Der Parser ist mit Beispielzeilen im dokumentierten GeoNames-Format getestet, aber
> noch nicht mit der echten Datei. Beim ersten Import bitte die Ausgabe prüfen: Wenn viele Zeilen mit
> „unbekannter Bezirk“ übersprungen werden, passt die Bezirkszuordnung nicht und muss nachgezogen werden.

Alternative amtliche Quelle: PLZ-Verzeichnis der Österreichischen Post bzw. Gemeinde- und Ortschaftsverzeichnis von
Statistik Austria (data.gv.at, CC BY 4.0). Diese liefern keine Koordinaten; dafür müsste zusätzlich geokodiert werden.

## Umkreissuche (Phase 2)

`locations.geom` ist ein `geography(Point, 4326)` mit GiST-Index. Abfrage-Muster:

```sql
SELECT l.* FROM listings l
JOIN locations o ON o.id = l.location_id
WHERE ST_DWithin(o.geom, ST_MakePoint(:lon, :lat)::geography, :meter);
```

In Meilisearch wird später `_geo` je Inserat aus dem Ort befüllt.
