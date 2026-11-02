# Foto-Assistent beim Inserieren

Beim Inserat aufgeben fügt man gleich im Formular Fotos hinzu: „Foto aufnehmen“ öffnet am Handy die Kamera (für jedes
weitere Foto noch einmal tippen), „Aus Galerie wählen“ nimmt mehrere auf einmal. Bis zu 10 Fotos, das erste ist das
Titelbild. Ist der Assistent eingeschaltet, erscheint daneben **„Mit KI ausfüllen“**. Die API lässt die ersten vier
Fotos zusammen von Claude (Anthropic) auswerten und schlägt vor:

- **Kategorie** (immer die unterste Ebene aus dem Kategoriebaum),
- **Titel** und **Beschreibung**,
- **Zusatzangaben** der Kategorie, z. B. Grafikspeicher, Chip, Marke, Kilometerstand, Wohnfläche.

Den **Zustand** wählt die Person selbst, ebenso Preis und Standort; die KI schlägt sie nie vor. Die Vorschläge landen
nur im Formular. Gespeichert wird erst, wenn die Person selbst „Veröffentlichen“ oder „Als Entwurf speichern“ drückt;
„Rückgängig“ stellt den Stand vor der Auswertung wieder her. Nach dem Speichern werden alle Fotos im Bilder-Schritt
automatisch hochgeladen – auch wenn der Assistent ausgeschaltet ist.

## Ablauf

1. Browser: Fotos aufnehmen oder auswählen, jedes auf höchstens 1600 px verkleinern (so groß speichert die API Bilder
   ohnehin) und als JPEG ohne Metadaten im Formular halten.
2. „Mit KI ausfüllen“: die ersten vier Fotos als Formulardaten an `POST /api/foto-assistent` (Next.js-Route, Token bleibt
   auf dem Server), von dort als `{ images: [Base64, …] }` an die API `POST /v1/autofill/listing` (angemeldet).
3. API: jedes Foto prüfen, drehen, Metadaten entfernen, auf 1568 px verkleinern und alle in **einer** Anfrage an die
   Claude-API schicken. Die Fotos werden **nirgends gespeichert** und nicht protokolliert (im Log stehen nur
   Tokenzahlen). Eine Auswertung zählt fürs Tageslimit einmal, egal wie viele Fotos.
4. Claude bekommt im System-Prompt die Kategorieliste und die Felddefinitionen aus
   `packages/shared/src/attributes/` (zwischengespeichert per Prompt-Caching) und antwortet im festen JSON-Format.
5. Die API prüft die Antwort mit denselben Regeln wie beim Speichern (`coerceAttributeSuggestions`): unbekannte
   Kategorien, fremde Felder und ungültige Werte fallen weg.
6. Bilder-Schritt: Die gemerkten Fotos (IndexedDB im Browser, höchstens 10 Minuten) werden hochgeladen und gelöscht.

Code: `apps/api/src/autofill/`, `apps/web/src/components/listing-form/photo-picker.tsx`,
`apps/web/src/lib/pending-photo.ts`. Tests: `apps/api/test/autofill.e2e-spec.ts` (lokaler Testserver statt
Claude-API), `apps/web/e2e/photo-assistant.spec.ts`, `packages/shared/src/autofill/autofill.test.ts`.

## Einschalten

In der `.env` des Servers (nicht im Repo):

```
AI_ENABLED=true
ANTHROPIC_API_KEY=sk-ant-…
AI_MODEL=claude-haiku-5-5         # empfohlen: günstig; claude-opus-5-5 liest schwierige Fotos besser, kostet ~40×
AI_AUTOFILL_USER_DAILY_LIMIT=20   # Auswertungen je Konto und Tag
AI_AUTOFILL_DAILY_LIMIT=300       # insgesamt je Tag (Kostenbremse)
```

Danach `deploy.sh` bzw. API neu starten. Ohne Schlüssel oder mit `AI_ENABLED=false` erscheint der Assistent nicht,
und die Datenschutzerklärung sagt „nicht aktiv“. Die Web-App fragt `GET /v1/autofill/status` (einige Minuten
zwischengespeichert).

Vorher:

1. Konto unter console.anthropic.com anlegen, Zahlungsmittel hinterlegen, **monatliches Ausgabenlimit** setzen
   (Settings → Limits). Das ist die harte Kostenbremse; die Tageslimits oben sind die zweite.
2. Den Auftragsverarbeitungsvertrag (Data Processing Addendum mit Standardvertragsklauseln) von Anthropic prüfen –
   er gilt laut Anthropic für kommerzielle API-Konten automatisch. Anthropic verwendet API-Daten nicht zum Training.
3. Den Abschnitt „Foto-Assistent“ in der Datenschutzerklärung (`apps/web/src/app/datenschutz/page.tsx`) noch einmal
   rechtlich prüfen lassen.

## Kosten (Richtwerte, Stand November 2026)

Pro Foto gehen etwa 1.600 Tokens Bild durch, pro Auswertung dazu ca. 10.000 Tokens Kategorieliste und Felder
(zwischengespeichert) und einige hundert Tokens Antwort. Vier Fotos kosten also etwa das Doppelte von einem.

| Modell (1 Foto) | wenn der Cache warm ist | erste Anfrage nach > 5 Minuten Pause |
| --- | --- | --- |
| `claude-opus-5-5` | ca. 2–3 Cent | ca. 7 Cent |
| `claude-haiku-5-5` | unter 0,1 Cent | ca. 0,2 Cent |

Bei 300 Fotos am Tag also höchstens rund 20 € am Tag mit Opus, unter 1 € mit Haiku. Der Cache gilt 5 Minuten;
bei wenig Betrieb ist fast jede Anfrage eine „erste“.

## Limits und Fehler

- 6 Auswertungen pro Minute je Konto (Rate-Limit), dazu die Tageslimits (Redis, sonst im Prozessspeicher).
- 1–4 Fotos pro Auswertung, je bis 4 MB (der Browser schickt ca. 0,3–1 MB), JPEG/PNG/WebP, mindestens 200 px an der
  kürzeren Seite. Ist ein Foto ungültig, geht nichts an die Claude-API.
- Lehnt Claude ein Foto ab, meldet die API 422; bei Störungen 503 – das Formular bleibt immer normal ausfüllbar.
- Bei Opus/Sonnet ist die serverseitige Ausweichlösung der Claude-API (`fallbacks: "default"`) eingeschaltet:
  Lehnt das Modell irrtümlich ab, versucht es die API selbst mit einem anderen Modell.

## Neue Kategorie-Felder

Damit der Assistent bei Technik mehr ausfüllen kann, gibt es seit diesem Schritt Zusatzfelder für
PC-Komponenten: Grafikkarten (Chiphersteller, Grafikchip, Grafikspeicher, Marke), Prozessoren (Hersteller, Modell,
Sockel), Mainboards (Marke, Sockel), Arbeitsspeicher (Kapazität, Speichertyp, Marke), Netzteile (Leistung, Marke)
sowie Festplatten & Speicher (Art, Kapazität, Marke). Je mehr Kategorien Felder haben, desto mehr füllt der Assistent
aus – neue Felder in `definitions.ts` kennt er automatisch.
