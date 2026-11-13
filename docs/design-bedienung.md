# Bedienung im Design

Neben der Bewegung ([design-bewegung.md](design-bewegung.md)) gibt es Regeln dafür, wie sich Markterl **anfühlt**:
große Tippflächen, nichts unter der Notch, „Rückgängig“ statt Sicherheitsabfrage, Fotos ohne graue Lücken.
Die Bausteine stehen in `packages/ui/src/ux.css` (eingebunden in `apps/web/src/app/globals.css`), die Helfer
für React in `apps/web/src/lib/` und `apps/web/src/components/`.

Grundlage sind 40 Regeln (20 aus der Animation und Wahrnehmung, 20 aus dem Handwerk guter Apps). Die Tabellen
zeigen, wo jede Regel umgesetzt ist – und welche bewusst nicht.

## Bausteine

| Baustein | Wo | Wofür |
| --- | --- | --- |
| `tap` | `ux.css` | Unsichtbar vergrößerte Tippfläche (mind. 44 × 44 px), nur für Finger (`pointer: coarse`). Das Element muss positioniert sein (`relative`). Alle Knöpfe aus `buttonClasses` haben sie schon |
| `safe-x`, `safe-top`, `safe-bottom` | `ux.css` | Abstand zu Notch, runden Ecken und Home-Leiste (`viewport-fit=cover` in `layout.tsx`) |
| Squircle-Ecken | `ux.css` | `corner-shape: squircle` für alle `rounded-*` (außer `rounded-full`), wo der Browser es kann; die Radien sind dort etwas größer |
| `field-nudge` | `ux.css` | Ein Feld mit `aria-invalid="true"` ruckt einmal kurz zur Seite |
| `SheetHeader` | `components/sheet-header.tsx` | Kopf der Filter am Handy: Griff, Schließen-Knopf, nach unten wegwischen (`sheetDismisses` in `lib/motion.ts`) |
| `undoable`, `showToast` | `lib/toast.ts`, `components/toaster.tsx` | Hinweis unten in der Mitte. `undoable` führt die Änderung erst aus, wenn der Hinweis ohne „Rückgängig“ endet |
| `UndoableItem`, `UndoRemoveButton` | `components/undo-remove.tsx` | Listeneintrag, der sofort verschwindet und sich zurückholen lässt |
| `CommandMenu`, `SearchShortcutHint` | `components/command-menu.tsx`, `command-dialog.tsx`, `lib/commands.ts` | Schnellmenü (Strg+K bzw. ⌘K) und der Hinweis darauf im Suchfeld |
| `Kbd`, `useModKey` | `components/kbd.tsx` | Tastenkürzel-Hinweis; „⌘“ am Mac, sonst „Strg“ |
| Foto-Platzhalter | API: `images/image-processor.ts`, Web: `listing-card-link.tsx`, `listing-gallery.tsx` | 16 × 12 px große Miniatur als Data-URI, liegt hinter dem Foto, bis es geladen ist |
| Foto gleitet in die Anzeige | `lib/photo-transition.ts`, `listing/detail-photo-slot.tsx` | View Transition von der Karte zur Galerie |
| `CardSkeleton`, `RowsSkeleton`, `FormSkeleton` | `components/skeletons.tsx` | Platzhalter beim Laden in der Form des Inhalts |

## Bild 1: Wahrnehmung und Animation

| Regel | Stand | Umsetzung |
| --- | --- | --- |
| Squash & stretch | erfüllt | Wandernde Markierung streckt sich (`indicator`), Drücken staucht (`press`) |
| Anticipation | erfüllt | `press`: der Knopf gibt nach, bevor etwas passiert |
| Staging | erfüllt | Ein Hauptknopf pro Ansicht (orange/grün), Dialoge dunkeln den Rest ab |
| Pose to pose | erfüllt | Zustände blenden ineinander (`Swap`), kein Springen |
| Follow through | erfüllt | `settle`: Inhalte kommen nach ihrem Behälter zur Ruhe |
| Slow in / slow out | erfüllt | `--ease-out`, `--ease-in-out` für alle Bewegungen |
| Arcs | erfüllt | `arcKeyframes` beim Umsortieren der Bilder |
| Secondary action | erfüllt | `confirm` (Herz, Glocke, Haken) |
| Snappy timing | erfüllt | Menüs 180 ms, Verschwinden 20 % kürzer |
| Exaggerated feedback | **neu** | Fehler im Formular: Feld ruckt einmal (`field-nudge`); Erfolg wie bisher `confirm-ring` |
| Solid drawing | erfüllt | Einheitliche Schatten und Ebenen (`--shadow-card`, `--shadow-card-hover`) |
| Appeal | erfüllt | Eigene Schriften, Farben, Topo-Muster |
| Fitts’ Gesetz | erfüllt | Fester Kontakt-Balken am Handy, Hauptknöpfe groß und am Rand |
| Bigger hit areas | **neu** | `tap` an Herz, Chips, Seitenzahlen, Text-Links, Schließen-Knöpfen; Reiter und Auswahlfelder am Handy 44 px hoch |
| Hicks Gesetz | erfüllt | Sechs Bereiche, gruppierte Seitenleiste, Filter je Kategorie |
| Millers Gesetz | erfüllt | Listen in Gruppen, höchstens fünf bis sieben Einträge je Gruppe |
| Doherty-Schwelle | erfüllt | Sofortige Rückmeldung (`useFormStatus`, optimistische Merkliste), Platzhalter beim Laden |
| Postels Gesetz | erfüllt | Preise, Zahlen und Postleitzahlen werden großzügig gelesen (`parseEuroInputToCents`, `parseLocaleNumber`) |
| Jakobs Gesetz | erfüllt | Aufbau wie bei bekannten Kleinanzeigen-Seiten: Suche oben, Filter links, Karten |
| Frequency of use | erfüllt | Häufige Wege im Kopf und im Schnellmenü, seltene in der Seitenleiste |

## Bild 2: Handwerk

| Regel | Stand | Umsetzung |
| --- | --- | --- |
| Skeleton loaders | **erweitert** | Öffentliche Seiten hatten Raster; Konto-Seiten, Suche und Startseite zeigen jetzt Karten, Zeilen und Formulare in ihrer späteren Form (`components/skeletons.tsx`) |
| Optimistic updates | erfüllt | Merken/Entmerken wirkt sofort (`FavoriteButton`), Nachrichten erscheinen sofort |
| Command menu | **neu** | Strg+K / ⌘K: Suche, häufige Wege, Bereiche, Hell/Dunkel |
| Shortcut hints | **neu** | „Strg K“ im Suchfeld, „Strg Z“ am Rückgängig-Knopf, Pfeiltasten/Enter/Esc im Schnellmenü – nur auf Geräten mit Maus |
| Undo toasts | **neu** | Gespeicherte Suche löschen und Einträge von der Merkliste entfernen: sofort weg, 7 s „Rückgängig“ (auch Strg+Z) |
| Stale-while-revalidate | erfüllt | Next.js-Cache (`use cache`, `cacheLife`) liefert sofort und erneuert im Hintergrund |
| Pre-rendering | erfüllt | Partial Prerendering und Prefetch der Links |
| BlurHash placeholders | **neu** | Verschwommene Miniatur hinter jedem Anzeigenfoto (Karte und Galerie); alte Fotos trägt ein Hintergrundjob nach |
| View transitions | **erweitert** | Hell/Dunkel gab es schon; neu gleitet das Foto von der Karte in die Anzeige |
| Swipe-to-dismiss sheets | **neu** | Filter am Handy (Suche, Deals, Dienstleistungen) am Kopf nach unten wegwischen |
| Interruptible animations | erfüllt | CSS-Übergänge lassen sich jederzeit umkehren; beim Ziehen ist der Übergang aus |
| Predictive back | **nicht umgesetzt** | Gibt es nur in Android-Apps; im Browser übernimmt das System die Zurück-Geste |
| Hit slop | **neu** | siehe `tap` |
| Safe area insets | **neu** | `viewport-fit=cover`; Kopf, Filter, Chat, Kontakt-Balken und Hinweise halten Abstand zu Notch und Home-Leiste |
| One-time code autofill | erfüllt | `autocomplete="one-time-code"` an beiden Feldern der Zwei-Faktor-Anmeldung |
| Tabular numbers | **neu** | Preise, Zähler, Seitenzahlen und Kartenzeilen mit `tabular-nums` |
| Balanced headlines | erfüllt | `text-wrap: balance` an h1–h3 |
| Continuous corners | **neu** | Squircle-Ecken, wo der Browser `corner-shape` kennt |
| Idempotency keys | erfüllt | `clientId` bei Anzeigen, Nachrichten, Deals, Dienstleistungen und Buchungen |
| Amazon safe triangle | **nicht umgesetzt** | Es gibt keine Untermenüs, die beim Überfahren aufklappen – Menüs öffnen auf Klick |

## Wo es weiter eine Rückfrage gibt

„Rückgängig“ ersetzt die Sicherheitsabfrage nur dort, wo sich die Änderung wirklich ohne Verlust zurücknehmen lässt.
Bewusst **mit** Rückfrage bleiben:

- **Anzeige löschen** (`ConfirmDeleteButton`): Fotos, Nachrichtenverläufe und Statistik hängen daran.
- **Bewertung löschen** und **Konto löschen**: nicht wiederherstellbar.
- **Zweiten Faktor entfernen**: Sicherheitseinstellung.

## Rückgängig: wie es abläuft

1. Klick auf „Löschen“/„Entfernen“: Der Eintrag wird ausgeblendet (`UndoableItem`), der Hinweis erscheint.
2. „Rückgängig“ oder Strg+Z: Der Eintrag ist wieder da, am Server ist nichts passiert.
3. Läuft der Hinweis ab (7 s; die Zeit steht, solange der Zeiger darauf ruht), kommt ein neuer Hinweis oder wird
   die Seite in den Hintergrund gelegt, ruft der Knopf die Server Action auf. Schlägt sie fehl, kommt der Eintrag
   zurück und ein roter Hinweis erklärt es.
4. Ohne JavaScript schickt derselbe Knopf das Formular ab – dann wird sofort gelöscht.

## Foto-Platzhalter

Beim Hochladen entsteht neben `large` und `thumb` eine 16 × 12 px große WebP-Miniatur. Sie steht als Data-URI
(rund 150 Zeichen) in `listing_images.placeholder`, kommt mit der Trefferliste (`imagePlaceholder`) und liegt als
Hintergrund hinter dem Foto. Der Browser zeichnet sie weich – ohne JavaScript, ohne zusätzliche Anfrage.

Für Fotos von früher läuft alle fünf Minuten `ImagePlaceholderService.backfill` (100 Stück je Lauf), bis keines
mehr fehlt. Lässt sich ein Vorschaubild nicht lesen, bleibt ein leerer Text stehen und das Bild wird übersprungen.

## Foto gleitet in die Anzeige

- Beim Klick auf eine Karte merkt sich `rememberPhoto` das Vorschaubild; nur dieses eine Foto bekommt den Namen
  `listing-photo` (`CardPhoto`). So darf dieselbe Anzeige mehrfach auf einer Seite stehen.
- Die Detailseite zeigt das Vorschaubild sofort an der Stelle der Galerie (`DetailPhotoSlot` im Lade-Platzhalter),
  danach liegt es hinter dem großen Bild, bis dieses geladen ist (`gallery-landing`).
- Die Bewegung selbst macht der Browser (View Transition, 320 ms, `--ease-in-out`). Ohne Unterstützung oder mit
  „Bewegung reduzieren“ wechselt die Seite wie bisher.
- Nur vorwärts: Beim Zurückgehen gleitet nichts.

## Tests

- `apps/web/e2e/ux-rules.spec.ts`: Tippflächen ≥ 44 px, Schnellmenü, Filter wegwischen, Platzhalter und Vorschaubild.
- `apps/web/e2e/interactions.spec.ts`, `deals.spec.ts`: Rückgängig bei gespeicherten Suchen und in der Merkliste.
- `apps/web/src/lib/*.test.ts`: `sheetDismisses`, `filterCommands`, `toast`, `photo-transition`.
- `apps/api/src/images/*.spec.ts`: Platzhalter beim Upload und beim Nachtragen.
