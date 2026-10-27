# Suche und Filter (Phase 4)

## Überblick

```
Browser /suche?…  ──►  Next.js (Server)  ──►  GET /v1/listings?…  ──►  ListingSearchService
                                                                       │
                                     Meilisearch (IDs, Trefferzahl) ◄──┤  bei Ausfall: PostgreSQL/PostGIS
                                                                       ▼
                                          PostgreSQL: Inserate laden + Sichtbarkeit erneut prüfen
```

- **Ein Suchmodell für Website und API** (`packages/shared/src/search/`): `parseSearchParams` liest die URL,
  `toSearchParams` schreibt sie. Die Such-URL der Website und die API verwenden dieselben deutschen Parameter,
  jede Suche ist als Link teilbar.
- **Filter kommen aus den Kategorie-Feldern** (Phase 3, `packages/shared/src/attributes/definitions.ts`). Ein Feld
  wird zum Filter, sobald es `filter: { param }` trägt. Es gibt keine zweite Filterkonfiguration
  (siehe [kategorie-felder.md](kategorie-felder.md)).
- **Meilisearch liefert nur IDs.** Die Inserate werden immer aus PostgreSQL geladen und dabei nochmals auf
  Sichtbarkeit geprüft (aktiv, nicht gelöscht, nicht abgelaufen, Verkäufer aktiv). Ein veralteter Indexeintrag
  kann deshalb nie einen Entwurf, ein pausiertes, gelöschtes oder abgelaufenes Inserat anzeigen; er wird
  aus der Trefferzahl herausgerechnet und sofort nachsynchronisiert.

## Parameter

| Parameter | Bedeutung | Beispiel |
| --- | --- | --- |
| `q` | Suchbegriff (Titel, Beschreibung, Eigenschaften, Kategorie, Ort) | `q=rennrad` |
| `bereich` | Marktplatz, Auto & Motor, Immobilien, Jobs | `bereich=auto-motor` |
| `kategorie` | Kategoriepfad, schließt Unterkategorien ein | `kategorie=marktplatz/sport-freizeit/fahrraeder` |
| `bundesland` | Bundesland-Slug | `bundesland=tirol` |
| `ort` / `plz` | Ort-ID aus der Ortssuche bzw. PLZ (dann der Hauptort der PLZ) | `plz=1010` |
| `umkreis` | 5, 10, 25, 50, 100 oder 200 km, nur mit Ort | `umkreis=25` |
| `preis_ab`, `preis_bis` | Preis bzw. Monatsmiete in Euro | `preis_bis=500` |
| `anbieter` | `privat` oder `gewerblich` | |
| `zustand` | `neu,wie-neu,gut,akzeptabel,defekt` (Mehrfachauswahl mit Komma) | `zustand=neu,gut` |
| `sortierung` | `relevanz`, `neueste`, `preis_auf`, `preis_ab`, `entfernung` (nur mit Ort) | |
| `seite` | Seite (24 Treffer je Seite, höchstens Seite 400) | |
| Eigenschaften | Auswahl: `kraftstoff=diesel,petrol`; Bereich: `kilometer_bis=100000`, `zimmer_ab=3`; Text: `modell=golf tsi`; Ja/Nein: `e-laden=ja` | |

Ohne Suchbegriff wird nach „neueste“ sortiert, mit Suchbegriff nach „relevanz“. Ungültige Werte liefern in der
API `400` mit deutschen Fehlermeldungen je Parameter; die Website ignoriert sie. Alte Parameter
(`categoryId`, `vertical`, `state`, `page`, `pageSize`) funktionieren weiter.

### Welche Filter erscheinen

- In einer Kategorie: alle Filter ihrer Felder.
- In einer Oberkategorie bzw. einem Bereich: die Filter, die mindestens zwei Unterkategorien gemeinsam haben
  (unter „Auto & Motor“ z. B. Marke, Kilometerstand, Kraftstoff, aber nicht Schlafplätze). Auswahllisten werden
  zusammengeführt (Marken von Autos und Motorrädern).
- Im Marktplatz als Ganzes gibt es keine Eigenschaftsfilter.
- Preis nur, wo es Preise gibt (nicht bei Jobs, dort Gehalt); Zustand nur bei Waren.
- **Gehalt** wird auf brutto pro Monat umgerechnet: Jahresgehalt / 14, Stundenlohn × Wochenstunden × 4,33.

## Meilisearch

Index `listings` (`MEILI_INDEX`), Dokument je sichtbarem Inserat (`apps/api/src/search/search-document.ts`):
Texte, Kategoriepfade samt Oberkategorien, Preis in Cent, Zustand, privat/gewerblich, Bundesland, PLZ, `_geo`,
Veröffentlichungszeit (ms), Ablaufzeit und die Filterwerte unter `attributes.*`. Seit Phase 7 zusätzlich
`sortedAt` (= späteres von Veröffentlichung und Hochschieben), `topUntil` (Top-Anzeige bis, Sekunden) und die
Dokumentversion `v`.

### Zusatzleistungen in der Suche (Phase 7)

- **Hochschieben:** „Neueste“ sortiert nach `sortedAt` (PostgreSQL: `COALESCE(GREATEST(published_at, bumped_at), created_at)`).
  Das Veröffentlichungsdatum ändert sich nicht.
- **Top-Anzeigen:** nur auf Seite 1, mit **denselben Filtern** wie die Suche plus `topUntil > jetzt`. Aus bis zu 100
  passenden Top-Anzeigen werden 3 gezeigt; die Auswahl wechselt alle 10 Minuten (Hash aus Zeitfenster und ID), damit
  keine Anzeige dauerhaft vorne steht. Gesperrte, pausierte, gelöschte und abgelaufene Inserate sind nie dabei
  (sie sind gar nicht im Index bzw. werden in PostgreSQL ausgefiltert). Die Antwort enthält `topAds`.
- **Hervorhebung:** die Karte trägt `highlighted`; bezahlte Platzierungen zusätzlich `sponsored` („Gesponsert“).
- Ablauf wirkt sofort (Vergleich mit „jetzt“); der Ablauf-Job aktualisiert danach die Dokumente einzeln.
- **Kein kompletter Neuaufbau nötig:** Dokumente mit älterer Version `v` gelten beim Abgleich als veraltet und werden
  einzeln neu geschrieben.

- **Tippfehler:** ab 4 Zeichen ein, ab 8 Zeichen zwei Fehler („fahrad“ findet Fahrrad). Synonyme z. B.
  Rad/Fahrrad, Auto/PKW, Wohnung/Apartment. Alle Suchwörter müssen vorkommen.
- **Sortierung:** stabil nach Veröffentlichung und ID, damit Meilisearch und PostgreSQL dieselbe Reihenfolge liefern.
- **Umkreis:** `_geoRadius` auf den Ortspunkt; Sortierung „Entfernung“ über `_geoPoint`.
- Die Sprache ist bewusst nicht auf Deutsch gestellt (`localizedAttributes: null`): mit der deutschen
  Wortzerlegung funktionierte die Tippfehlertoleranz bei zusammengesetzten Wörtern nicht mehr.

### Aktualität des Index

| Ereignis | Was passiert |
| --- | --- |
| Anlegen, Bearbeiten, Veröffentlichen, Pausieren, Fortsetzen, Löschen | Inserat wird nach dem Speichern synchronisiert: sichtbar → hinzufügen/ersetzen, sonst entfernen |
| Meilisearch kurz nicht erreichbar | ID kommt in eine Warteliste, Wartung alle 60 s versucht es erneut |
| Inserat läuft ab | Wartung entfernt abgelaufene Dokumente per Filter; bis dahin blendet die Datenbankprüfung sie aus |
| API-Start | Abgleich: fehlende, veraltete und überzählige Dokumente werden korrigiert |
| `pnpm --filter @marktat/api search:reindex` | Kompletter Neuaufbau in einen Zweitindex, danach Tausch ohne Ausfallzeit |

### Ausfall von Meilisearch

Ist Meilisearch nicht konfiguriert (`MEILI_URL` leer) oder nicht erreichbar, sucht die API mit denselben Filtern
direkt in PostgreSQL (Textsuche mit `ILIKE`, Umkreis mit PostGIS `ST_DWithin`). Nach einem Fehler bleibt sie
30 Sekunden bei PostgreSQL, damit nicht jede Anfrage auf das Zeitlimit (3 s) wartet. Die Antwort enthält
`engine: "meilisearch" | "postgres"`. Im PostgreSQL-Modus gibt es keine Tippfehlertoleranz.

## Website (`apps/web/src/app/suche`)

- Desktop: Filter in der Seitenleiste. Auswahlfelder wirken sofort, Zahlen und Text beim Verlassen des Feldes
  oder mit Enter.
- Smartphone: Knopf „Filter“ mit Anzahl aktiver Filter öffnet ein Vollbild-Menü (Escape schließt, Fokus bleibt im
  Menü), unten „Zurücksetzen“ und „N Anzeigen“.
- Aktive Filter als entfernbare Chips plus „Alle zurücksetzen“, Brotkrumen, Sortierung, nummerierte Seiten,
  Leerzustand mit Vorschlag „Umkreis erweitern“, Entfernung auf den Karten.
- Die Ortssuche (`LocationInput`) ist eine barrierefreie Combobox über `GET /v1/geo/locations`.

## Tests

| Ebene | Datei |
| --- | --- |
| Suchmodell, Filter, URL-Roundtrip | `packages/shared/src/search/search.test.ts` |
| Meilisearch-Filter und SQL-Bedingungen | `apps/api/src/search/search-query.spec.ts` |
| API mit echtem Meilisearch und PostgreSQL: Volltext, Tippfehler, Filter je Bereich, Umkreis, Sortierung, Lebenszyklus, Ausfall, Abgleich, Reindex, gleiche Ergebnisse beider Wege | `apps/api/test/search.e2e-spec.ts` |
| Chips, Links, Formular → URL | `apps/web/src/lib/search.test.ts` |
| Top-Anzeigen-Rotation | `apps/api/src/search/top-ads.spec.ts` |
| Top-Anzeigen, Hochschieben, Ausweichbetrieb mit Top-Anzeigen | `apps/api/test/billing.e2e-spec.ts` |
| Browser (Desktop + Smartphone) | `apps/web/e2e/search.spec.ts`, `apps/web/e2e/monetization.spec.ts` |

## Bekannte Einschränkungen

- Der PostgreSQL-Fallback kennt keine Tippfehler und sortiert „Relevanz“ nur grob (Titeltreffer zuerst).
- Meilisearch liefert höchstens 10.000 Treffer je Suche (`maxTotalHits`); bei 24 je Seite sind das über 400 Seiten.
- Die Entfernung bezieht sich auf Ortsmittelpunkte (siehe [geodaten.md](geodaten.md)).
- Gespeicherte Suchen und Benachrichtigungen sind nicht Teil von Phase 4.
