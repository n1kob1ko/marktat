# Anzeigenseite: Karte, mehr vom Anbieter, ähnliche Anzeigen

Unter bzw. neben einer öffentlichen Anzeige (`/anzeige/:id`) zeigt Markterl:

- **Standort-Karte** (rechte Spalte, am Handy unter dem Kontakt): eine Punktkarte von Österreich mit einem Kreis
  am **Mittelpunkt des Orts** (PLZ + Ort aus dem Ortsverzeichnis). Eine genaue Adresse gibt es bei Inseraten nicht,
  der Kreis macht das sichtbar. Die Karte ist ein eingebettetes SVG – es wird kein Kartendienst geladen, es gehen also
  keine Daten an Dritte. „In OpenStreetMap ansehen“ öffnet den Ort erst auf Klick in einem neuen Tab.
- **Mehr von {Anbieter}**: bis zu 4 weitere öffentliche Anzeigen desselben Kontos, neueste zuerst. Bei Händlern
  führt „Alle … Anzeigen“ zum Händlerprofil, private Konten haben keine eigene Profilseite.
- **Ähnliche Anzeigen in der Nähe**: bis zu 8 öffentliche Anzeigen derselben Kategorie von **anderen** Anbietern,
  nächstgelegene zuerst (Luftlinie zwischen den Ortsmittelpunkten, PostGIS), bei gleicher Entfernung die neuesten.
  Gibt es weniger als 4, kommen Anzeigen aus der übergeordneten Kategorie dazu (z. B. „Fahrradzubehör“ zu
  „Fahrräder“), nie aus dem ganzen Bereich. Am Handy und Tablet werden 4 gezeigt, am Desktop 8.

Beides gibt es nur bei aktiven, öffentlich sichtbaren Anzeigen; pausierte, abgelaufene oder gesperrte tauchen in
keiner Liste auf (dieselbe Regel wie in der Suche).

## Schnittstelle

- `GET /v1/listings/:id` enthält `mapPoint` (`{ latitude, longitude }` des Ortsmittelpunkts oder `null`).
- `GET /v1/listings/:id/related` (öffentlich) → `{ similar, fromSeller, sellerTotal }`; zu nicht öffentlichen oder
  unbekannten Anzeigen leere Listen. `similar[].distanceKm` ist die Entfernung zur angesehenen Anzeige.

## Punktkarte neu erzeugen

`apps/web/src/components/listing/austria-dots.ts` wird aus dem Ortsverzeichnis
(`apps/api/prisma/seed/data/at-locations.tsv.gz`, GeoNames, CC BY 4.0 – Namensnennung steht im Impressum) erzeugt:

```bash
node apps/web/scripts/build-austria-map.mjs
```

Jedes Rasterfeld (ca. 7,8 km) mit mindestens einem Ort wird ein Punkt, fast umschlossene Lücken werden gefüllt.
Die Projektion (`MAP_GRID` in `austria-map.tsx`) muss zu den Konstanten im Skript passen.

Tests: `apps/api/test/related-listings.e2e-spec.ts`, `apps/web/e2e/listing-page.spec.ts`.
