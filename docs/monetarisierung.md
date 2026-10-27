# Monetarisierung (Phase 7)

MarktAT startet **vollständig kostenlos**. Das Monetarisierungssystem ist vollständig gebaut, verrechnet aber nichts,
solange der kostenlose Betrieb aktiv ist (Standard). Was später etwas kostet und wie viel, entscheidet ein Admin
unter `/admin/monetarisierung`. Endgültige Preise sind bewusst **nicht** festgelegt.

Grundsätze, die der Code erzwingt:

- **Keine echten Zahlungen** ohne ausdrückliche Umstellung *und* nutzbares Stripe; Live-Schlüssel sind gesperrt.
- **Keine automatische Umstellung:** Weder ein Aktionsende noch ein geplanter Preis noch eine Produktfreigabe schaltet
  den kostenpflichtigen Betrieb ein. Das geht nur über `PUT /v1/admin/billing/mode` mit der Bestätigung
  `KOSTENPFLICHTIG`.
- **Keine rückwirkenden Gebühren:** Jede Buchung speichert ihren Preis zum Buchungszeitpunkt (`price_cents` plus
  `snapshot`). Kostenlos gebuchte Leistungen und Inserate bleiben für ihre Laufzeit kostenlos.
- Beträge sind immer ganze Cent (`INTEGER`, CHECK ≥ 0), Währung EUR. Der Browser schickt nie einen Preis.

## Leistungen (Tabelle `products`)

| Code | Art | Wirkung | Entwicklungsstandard (keine Geschäftsregel) |
| --- | --- | --- | --- |
| `listing` | Inserat | Veröffentlichen bzw. Verlängern | 60 Tage, privat und gewerblich, nicht abschaltbar |
| `highlight` | Hervorhebung | Farbiger Rahmen und getönter Textbereich auf der Karte, Label „Hervorgehoben“ | 7 Tage; je Konto höchstens 5 gleichzeitig und 10 in 30 Tagen |
| `top` | Top-Anzeige | Bereich „Top-Anzeigen“ über passenden Suchergebnissen (Seite 1), Label „Top“ | 7 Tage; je Konto 2 gleichzeitig, insgesamt 200 gleichzeitig, 4 in 30 Tagen |
| `bump` | Hochschieben | Neuer `bumped_at`; Sortierung „Neueste“ nutzt `max(published_at, bumped_at)`, das Veröffentlichungsdatum bleibt | einmalig; Mindestabstand 24 h je Inserat, 30 in 30 Tagen |

Zusätzlich gilt je Konto eine Grenze von **20 Zusatzleistungs-Buchungen pro Stunde** (`platform_settings.max_bookings_per_hour`).
Alle Werte sind im Admin-Bereich änderbar und werden ausschließlich serverseitig geprüft
(`BookingsService.evaluate`). Die Startwerte stehen in der Migration `20261028090000_monetization` und in
`DEFAULT_PRODUCTS` (`apps/api/src/billing/pricing.service.ts`); fehlende Zeilen werden beim Start ergänzt,
bestehende nie überschrieben.

Felder je Leistung: `price_cents` (aktueller Preis), `planned_price_cents` (nur Information), `duration_days`,
`for_private`/`for_business`, `is_active`, `paid_enabled`, optionaler Aktionszeitraum `promo_starts_at`/`promo_ends_at`
(Ende ausschließlich), `max_active_per_user`, `max_active_total`, `max_per_period` je `period_days`, `cooldown_hours`.

### Welcher Preis gilt? (`effectivePrice` in `packages/shared/src/billing.ts`)

Bezahlt wird nur, wenn **alle** Bedingungen erfüllt sind – sonst 0,00 €:

1. Betriebsmodus PAID **und** Stripe nutzbar (`PricingService.effectiveMode`, sonst gilt FREE),
2. `paid_enabled` der Leistung,
3. nicht im Aktionszeitraum,
4. `price_cents > 0`.

Fällt die Stripe-Konfiguration im PAID-Betrieb weg, wird wieder kostenlos gebucht (lieber kostenlos als eine
Zahlung, die nicht abgewickelt werden kann).

## Betriebsmodus

| Modus | Verhalten |
| --- | --- |
| **FREE** (Standard) | Kein Stripe-Aufruf, keine Zahlungsdaten, keine späteren Kosten. Geplante Preise sind einstellbar und werden nur angezeigt, wenn die Einführungsaktion es so einstellt. |
| **PAID** | Nur nach Bestätigung im Admin-Bereich und ohne Hindernisse. Hindernisse (`paidModeBlockers`): kein Stripe-Schlüssel, kein Webhook-Secret, Live-Schlüssel ohne `STRIPE_LIVE_ENABLED=true`, in Produktion jeder Nicht-Live-Schlüssel. |

Jede Umschaltung, Preis- und Einstellungsänderung landet im Audit-Log (`admin.billing_mode_changed`,
`admin.product_updated` mit Vorher/Nachher, `admin.billing_settings_updated`). Gleichzeitige Änderungen werden über
`expectedUpdatedAt` erkannt (409 „Die Leistung wurde inzwischen geändert“).

## Einführungsaktion

Einstellungen in `platform_settings`: an/aus, sichtbar, Titel, Beschreibung, optional Beginn und Ende, geplanten
Standardpreis nennen. Angezeigt auf `/inserieren`, der Startseite, unter „Meine Leistungen“ und als Vorschau im Admin.

- „Einführungsaktion · 0,00 € · Jetzt kostenlos inserieren · Während unserer Einführungsphase …“
- Nur mit Enddatum: „Kostenlos für neue Inserate bis zum [Datum].“ (letzter enthaltener Tag)
- Nur wenn eingestellt: „Geplanter Standardpreis nach der Einführungsphase: [Preis].“
- Immer: „Was du jetzt kostenlos veröffentlichst, bleibt für die gesamte Laufzeit kostenlos.“
- Kein durchgestrichener Preis, keine künstliche Frist, kein Rabatt-Wording. Kostet Inserieren tatsächlich etwas,
  verschwindet die Aktion.

## Preise und Aktionen im Admin verwalten

`/admin/monetarisierung` (nur Rolle ADMIN, Reiter „Monetarisierung“):

1. **Betriebsmodus:** aktueller Modus, Stripe-Status, Liste der Hindernisse. Einschalten nur durch Eintippen von
   `KOSTENPFLICHTIG`; der Knopf ist gesperrt, solange Hindernisse bestehen. Zurück zu FREE geht jederzeit.
2. **Zahlen:** laufende Leistungen, Buchungen der letzten 30 Tage, bezahlte Buchungen, Umsatz abzüglich Erstattungen.
3. **Leistungen und Preise:** je Leistung Name, Beschreibung, Laufzeit, Preis (Eingabe in Euro, z. B. `4,90`),
   geplanter Preis, „Preis verrechnen“ (`paid_enabled`), Aktionszeitraum (Datumsfelder in Wiener Zeit; „bis
   einschließlich“), Verfügbarkeit für private/gewerbliche Konten, buchbar ja/nein, Limits (leer = ohne Grenze).
   Oben steht der aktuell gültige Preis mit Begründung (z. B. „Kostenloser Plattformbetrieb“).
4. **Einführungsaktion:** Einstellungen plus Live-Vorschau.
5. **Buchungen ansehen:** `/admin/monetarisierung/buchungen` mit Filtern nach Status, Leistung und kostenlos/bezahlt.

## Buchungsablauf (`apps/api/src/billing/bookings.service.ts`)

`POST /v1/listings/:id/bookings` mit `{ product, idempotencyKey }` (strikt, kein Preis):

```
prüfen (eigenes, aktives Inserat; Konto aktiv; Limits; Stundenlimit)
  → unter Advisory-Lock je Konto (und je Leistung bei Gesamtlimit)
  → Preis berechnen, Schnappschuss speichern
  → kostenlos: sofort ACTIVE/COMPLETED, Wirkung am Inserat, Laufzeit ab jetzt
  → kostenpflichtig: PENDING_PAYMENT + Payment(PENDING) → Stripe Checkout → Webhook prüft → activatePaid
```

- **Idempotenz:** `(user_id, idempotency_key)` ist eindeutig; ein wiederholter Aufruf liefert dieselbe Buchung.
  Die Web-App erzeugt je Formular einen neuen Schlüssel (Doppelklick = eine Buchung).
- **Doppelte Aktivierung** ist ausgeschlossen: `activatePaid` sperrt je Buchung und aktiviert nur aus
  `PENDING_PAYMENT`; Stripe-Ereignisse werden über `stripe_events` genau einmal verarbeitet.
- **Wirkung am Inserat:** `highlighted_until`, `top_until`, `bumped_at`, `highlight_paid`, `top_paid` (per SQL gesetzt,
  damit `updated_at` – die Moderationsversion – unverändert bleibt). Abfragen vergleichen immer mit „jetzt“, d. h.
  abgelaufene Vorteile wirken sofort nicht mehr.
- **Ablauf-Job** `promotion-expiry` (BullMQ, alle 5 Minuten, wiederholbar): Buchungen → EXPIRED, Felder am Inserat
  leeren, Suchindex aktualisieren, offene Zahlungen nach 2 h verfallen lassen.
- **Veröffentlichen:** Kostet das Inserieren nichts, legt `create`/`publish` eine kostenlose LISTING-Buchung in
  derselben Transaktion an. Kostet es etwas (nur PAID), antwortet `publish` mit 402 und die Web-App führt zur
  Buchung unter „Leistungen“; online geht das Inserat erst nach bestätigter Zahlung.
- **Gesperrte Konten** können nicht buchen (403), fremde Inserate liefern 404, pausierte/abgelaufene 409.

## Stripe (nur Testmodus)

Eigener schlanker Client über `fetch` (`stripe.gateway.ts`), austauschbar über das Token `STRIPE_GATEWAY`.

| Teil | Umsetzung |
| --- | --- |
| Checkout | `POST /v1/checkout/sessions`, `client_reference_id` und `metadata.bookingId`, Idempotency-Key `checkout-<buchung>`, 30 min gültig, Rückkehr nach `/konto/leistungen/zahlung` |
| Webhook | `POST /v1/billing/stripe/webhook`, Rohdaten, HMAC-SHA256-Signatur mit 300 s Toleranz, konstante Vergleichszeit; ohne Secret 503 |
| Ereignisse | `checkout.session.completed` / `async_payment_succeeded` → aktivieren; `async_payment_failed` / `expired` → schließen; `charge.refunded` → (teil)erstatten, bei voller Erstattung endet die Leistung sofort |
| Prüfung vor Aktivierung | Session-ID, Buchungs-ID, Betrag, Währung, Live-/Testmodus müssen zur gespeicherten Zahlung passen, sonst FAILED + CANCELLED |
| Rückkehrseite | fragt den Status selbst bei Stripe ab (`/bookings/:id/confirm`); ein manipulierter Rückkehr-Link schaltet nichts frei; Abbruch beendet die Buchung ohne Kosten |
| Beleg/Rechnung | Felder `receipt_url`, `invoice_number` vorbereitet; Rechnungsstellung selbst ist offen |

**Live-Modus gesperrt:** `sk_live_…` wird ignoriert (`usable: false`), solange `STRIPE_LIVE_ENABLED` nicht `true`
ist; Live-Ereignisse werden abgelehnt und protokolliert. `STRIPE_LIVE_ENABLED` erst nach ausdrücklicher Freigabe
setzen. Stripe-Schlüssel erreichen nie den Browser (kein Publishable Key nötig – Checkout läuft per Weiterleitung).

### Testmodus lokal einrichten

```bash
# .env (lokal, nicht committen)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...      # aus: stripe listen --forward-to localhost:4000/v1/billing/stripe/webhook
STRIPE_LIVE_ENABLED=false
```

Danach im Admin umschalten, eine Leistung mit Preis freigeben und mit der Testkarte `4242 4242 4242 4242` bezahlen.

## Tests

| Ebene | Datei |
| --- | --- |
| Preislogik, Aktion, Schemas, Wiener Kalendertage | `packages/shared/src/billing.test.ts` |
| Signatur (gültig, falsch, verändert, abgelaufen), Live-Sperre, Formularkodierung | `apps/api/src/billing/stripe.gateway.spec.ts` |
| Faire Rotation der Top-Anzeigen | `apps/api/src/search/top-ads.spec.ts` |
| Gratisbetrieb: Schnappschuss, Idempotenz, Limits, Sicherheit, Hochschieben, Top-Anzeigen samt Filtern und Ausweichbetrieb, Ablauf, Statistik, Admin, Händler | `apps/api/test/billing.e2e-spec.ts` |
| Kostenpflichtiger Ablauf gegen ein Stripe-Testdouble: Checkout, Signatur, Betrag, Live-Ereignis, Duplikat, Bestätigung, Abbruch, Erstattung, Ablauf, bezahltes Veröffentlichen, Ausfall, Live-Sperre | `apps/api/test/billing-paid.e2e-spec.ts` |
| Browser (Desktop + Smartphone): Einführungsaktion, Leistungen buchen, Limits, Top-Anzeigen, Statistik, Händlerprofil, Admin | `apps/web/e2e/monetization.spec.ts` |

## Offen

- **Echte Stripe-Integrationstests** gegen den Stripe-Testmodus fehlen, weil keine Test-Zugangsdaten vorliegen. Die
  HTTP-Anbindung (`HttpStripeGateway`) ist nur über das Testdouble abgedeckt. Vor dem ersten kostenpflichtigen
  Betrieb: Testschlüssel setzen, `stripe listen` verbinden und den Ablauf einmal vollständig durchspielen.
- Rechnungen (Rechnungsnummer, PDF, USt-Ausweis) und eine eigene Zahlungsübersicht im Admin.
- Händlerpakete/Abos sind vorbereitet (Kontingente je Leistung), aber nicht gebaut.
- Rechtliche Prüfung von Preisangaben, Kennzeichnung bezahlter Platzierungen und AGB vor dem kostenpflichtigen Start.
