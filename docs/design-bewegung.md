# Bewegung im Design

Markterl bewegt sich überall nach denselben Regeln. Kurven, Dauern und Bausteine stehen an **einer** Stelle
(`packages/ui/src/motion.css`, eingebunden in `apps/web/src/app/globals.css`); die Helfer für React liegen in
`apps/web/src/lib/motion.ts`. Es gibt keine Animationsbibliothek – alles läuft über CSS-Übergänge, die Web Animations
API und die View Transitions API des Browsers. Das hält die Seite schnell und bleibt auch ohne JavaScript benutzbar.

## Grundsätze

| Nr. | Regel | Umsetzung |
| --- | --- | --- |
| 1 | Erscheinen mit ease-out | `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`; gilt auch für die Tailwind-Klasse `ease-out`. Klassen `enter`, `enter-pop`, `pop`, `drop`, `sheet`, `dialog.modal` |
| 2 | Menüs in 150–250 ms | `--motion-pop: 180ms` (Teilen-Menü, Chat-Menü, Ortsvorschläge, Suche am Handy) |
| 3 | Listenzeilen 30 ms versetzt | Klasse `stagger` am Behälter (Kartenraster, Postfach, Menüeinträge); höchstens zwölf Stufen |
| 4 | Beim Drücken auf 97 % | Klasse `press` (alle Knöpfe über `buttonVariants`, Chips, Reiter, Seitenzahlen); Karten `press-soft` (98,5 %) |
| 5 | Wandernde Markierung streckt sich um 12 % | `SlidingIndicator` (Bereichsleiste, Seitenleiste in Konto/Admin, Reiter der Merkliste, Filter im Postfach) |
| 6 | Details kommen nach ihrem Behälter zur Ruhe | Klasse `settle` zusätzlich zu `stagger` (Inhalt von Menüs und Dialogen startet 40 ms später, kürzerer Weg) |
| 7 | Bögen statt gerader Wege | `arcKeyframes` + `useFlip`: Bilder tauschen beim Umsortieren die Plätze in einem Bogen (Bildverwaltung) |
| 8 | Erfolg kurz bestätigen | Klasse `confirm` (Herz, Glocke des Preisalarms, Haken bei „Link kopiert“), `confirm-ring` an Erfolgsmeldungen (`Alert`) |
| 9 | Bewegung von A nach B mit ease-in-out | `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`: Markierung, Umsortieren, Sprung in der Galerie, Aufklappen |
| 10 | Popover starten bei 95 % | `pop`, `enter-pop`, `dialog.modal` – nie von 0 |
| 11 | Aus dem Auslöser heraus | `origin-top-right` usw. am Menü; Hell/Dunkel wird kreisförmig vom Umschalter aus aufgedeckt |
| 12 | Zum Auslöser zurück | `usePresence` hält das Element bis zum Ende des Ausblendens im Baum, `data-state="closed"` spielt den Weg zurück |
| 13 | Kein Nachfedern | Es gibt keine Kurve mit Überschwingen und keine Federn |
| 14 | Nichts glätten, solange gehalten wird | Galerie: `data-dragging="true"` schaltet den Übergang ab, das Bild klebt am Finger |
| 15 | Verschwinden 20 % kürzer | `--motion-pop-exit: 144ms`, `--motion-modal-exit: 176ms`, `--motion-sheet-exit: 208ms` |
| 16 | Alt und Neu überlappen | `Swap` (`@marktat/ui`): beide Zustände liegen übereinander und blenden gleichzeitig |
| 17 | Masken zum Aufdecken und für Farbe | `drop` (Suchleiste am Handy, `clip-path`), Hell/Dunkel (`clip-path`-Kreis), `details.reveal` |
| 18 | Symbole überblenden mit Unschärfe | `Swap`: 4 px Unschärfe bei Symbolen, 2 px bei Text (`kind="text"`) |
| 19 | Gummiband über die Grenze hinaus | `rubberBand` in der Galerie am ersten und letzten Bild |
| 20 | Dasselbe Element wiederverwenden | `SlidingIndicator`: ein Element wandert, statt am alten Platz zu verschwinden und am neuen aufzutauchen |

Bewegt werden nur `opacity`, `scale`, `translate`, `clip-path` und `filter` – nichts, was die Seite neu umbricht.
Einzige Ausnahme ist die Höhe aufklappbarer Bereiche (`details.reveal`), und die nur in Browsern, die das ohne
Ruckeln können (`interpolate-size`).

## Bausteine

| Klasse / Baustein | Wofür | Hinweis |
| --- | --- | --- |
| `press`, `press-soft` | alles, was man drücken kann | ersetzt `transition-colors` am selben Element (sonst gewinnt die Tailwind-Klasse) |
| `pop` + `data-state` | Menüs, Popover | `origin-*` passend zum Auslöser setzen; mit `usePresence(open)` verwenden |
| `drop` + `data-state` | Leiste, die unter einer Kante hervorkommt | geschlossen zusätzlich `inert` setzen |
| `ModalDialog` (`components/modal-dialog.tsx`) | Dialoge | bleibt in der Mitte; schließen über `closeDialog(event)` |
| `sheet` + `data-open` | bildschirmfüllende Filter am Handy | wirkt nur unter 64 rem Breite |
| `enter`, `enter-pop` | einzelnes Element erscheint | `enter` bewegt `translate` – nicht auf Elementen mit `translate-*`-Klassen, dort `enter-pop` |
| `stagger`, `settle` | Kinder erscheinen nacheinander | `--rise` verkürzt den Weg, `--stagger-base` verschiebt den Start |
| `confirm`, `confirm-ring` | Erfolg | einmalig; `confirm` nach `onAnimationEnd` wieder entfernen |
| `Swap` | zwei Zustände an derselben Stelle | Breite bleibt die des längeren Zustands |
| `SlidingIndicator` | Markierung des aktiven Eintrags | als erstes Kind in einen Behälter mit `relative group/nav`; Einträge blenden ihre eigene Markierung mit `group-data-[indicator]/nav:…` aus |
| `useFlip` + `data-flip-id` | Elemente wechseln den Platz | `order` ist eine Kennung der Reihenfolge |
| `swipe-track` | wischbare Leiste | `data-move="jump"` für Sprünge über mehrere Bilder |
| `reveal` an `<details>` | Aufklappen | nicht verwenden, wenn im Inhalt ein Menü über den Rand hinausragen muss (der Inhalt wird beschnitten) |

## Wann nichts bewegt wird

- **Einstellung „Bewegung reduzieren“** am Gerät: Alle Übergänge und Verzögerungen fallen weg (`globals.css`),
  der Wechsel Hell/Dunkel und die wandernde Markierung springen. Die Bedienung bleibt gleich.
- **Tastatur**: Pfeiltasten in der Galerie und `Escape` lösen keine zusätzlichen Effekte aus.
- **Ladezustände**: Der Ladekreis dreht schneller (0,75 s), sonst bleibt alles ruhig.
- Seiten, die man ständig sieht (Suchergebnisse beim Blättern), bekommen nur den kurzen Versatz der Karten.

## Bildergalerie der Anzeige

`components/listing-gallery.tsx`: Wischen mit Finger oder Maus, Pfeile (nur mit Maus sichtbar), Zähler,
Vorschaubilder, Pfeiltasten. Ein Wisch zählt ab einem Viertel der Breite oder wenn er schnell genug ist
(`swipeTarget`). Senkrechtes Wischen scrollt weiterhin die Seite. Geladen werden nur das gezeigte Bild und seine
Nachbarn.

## Tests

- `apps/web/src/lib/motion.test.ts`: Gummiband, Wisch-Ziel, Bögen.
- `apps/web/e2e/motion.spec.ts`: Drücken, Menü (Ursprung, Dauer, Verschwinden), Markierung, Hell/Dunkel,
  Filter am Handy, Galerie (Ziehen, Einrasten, Gummiband), Umsortieren, Dialog, reduzierte Bewegung.
