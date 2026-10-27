'use client';

import { useActionState } from 'react';
import { Alert, Checkbox, Field, Input, Textarea } from '@marktat/ui';
import {
  PAID_MODE_CONFIRMATION,
  lastIncludedDay,
  viennaDay,
  type BillingMode,
  type BillingSettingsDto,
  type ProductDto,
} from '@marktat/shared';
import { initialFormState, type FormState } from '@/lib/form-state';
import { SubmitButton } from '@/components/submit-button';
import { setBillingModeAction, updateBillingSettingsAction, updateProductAction } from '@/app/admin/monetarisierung/actions';

function StateAlert({ state }: { state: FormState }) {
  if (state.status === 'idle' || !state.message) return null;
  return <Alert tone={state.status === 'success' ? 'success' : 'danger'}>{state.message}</Alert>;
}

const euro = (cents: number | null) => (cents === null ? '' : (cents / 100).toLocaleString('de-AT', { minimumFractionDigits: cents % 100 ? 2 : 0 }));
const int = (value: number | null) => (value === null ? '' : String(value));
const startDay = (value: string | null) => (value ? viennaDay(value) : '');
/** Gespeichert ist das ausschließliche Ende (00:00 Uhr des Folgetags); im Formular steht der letzte enthaltene Tag */
const endDay = (value: string | null) => (value ? viennaDay(lastIncludedDay(value)) : '');

/** Preis, Laufzeit, Verfügbarkeit, Aktion und Limits einer Leistung */
export function ProductForm({ product }: { product: ProductDto }) {
  const [state, action] = useActionState(updateProductAction, initialFormState);
  const errors = state.fieldErrors ?? {};
  const v = (key: string, fallback: string) => state.values?.[key] ?? fallback;
  const isListing = product.kind === 'LISTING';
  const isBump = product.kind === 'BUMP';
  // Nach dem Speichern neue Version laden, damit der nächste Speichervorgang nicht als Konflikt gilt
  const key = product.updatedAt;

  return (
    <form key={key} action={action} className="space-y-5" noValidate>
      <StateAlert state={state} />
      <input type="hidden" name="code" value={product.code} />
      <input type="hidden" name="expectedUpdatedAt" value={product.updatedAt} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={errors.name} required>
          <Input name="name" defaultValue={v('name', product.name)} maxLength={80} />
        </Field>
        {isBump ? null : (
          <Field label="Laufzeit (Tage)" error={errors.durationDays} required>
            <Input name="durationDays" inputMode="numeric" defaultValue={v('durationDays', int(product.durationDays))} />
          </Field>
        )}
      </div>
      <Field label="Beschreibung (öffentlich)" error={errors.description}>
        <Textarea name="description" rows={2} maxLength={500} className="min-h-16" defaultValue={v('description', product.description)} />
      </Field>

      <fieldset className="space-y-4 rounded-xl border border-line p-4">
        <legend className="px-1 text-sm font-semibold">Preis</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Preis (€)" hint="Wird nur im kostenpflichtigen Betrieb und mit Freigabe unten verrechnet." error={errors.price} required>
            <Input name="price" inputMode="decimal" defaultValue={v('price', euro(product.priceCents))} />
          </Field>
          <Field label="Geplanter Preis (€, optional)" hint="Nur zur Information, z. B. für die Einführungsaktion." error={errors.plannedPrice}>
            <Input name="plannedPrice" inputMode="decimal" defaultValue={v('plannedPrice', euro(product.plannedPriceCents))} />
          </Field>
        </div>
        <Checkbox
          name="paidEnabled"
          defaultChecked={product.paidEnabled}
          label={
            <>
              <span className="font-semibold text-ink-900">Preis verrechnen</span> – erst wirksam, wenn der kostenpflichtige Betrieb eingeschaltet ist. Gilt nur für
              neue Buchungen, nie rückwirkend.
            </>
          }
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Aktion von (optional)" hint="In diesem Zeitraum ist die Leistung kostenlos." error={errors.promoStartsAt}>
            <Input name="promoStartsAt" type="date" defaultValue={v('promoStartsAt', startDay(product.promoStartsAt))} />
          </Field>
          <Field label="Aktion bis einschließlich (optional)" hint="Das Ende schaltet nichts automatisch kostenpflichtig." error={errors.promoEndsAt}>
            <Input name="promoEndsAt" type="date" defaultValue={v('promoEndsAt', endDay(product.promoEndsAt))} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-xl border border-line p-4">
        <legend className="px-1 text-sm font-semibold">Verfügbarkeit</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Checkbox name="forPrivate" defaultChecked={product.forPrivate} label="Private Konten" />
          <Checkbox name="forBusiness" defaultChecked={product.forBusiness} label="Gewerbliche Konten" />
          {isListing ? (
            // Inserieren lässt sich nicht abschalten
            <input type="hidden" name="isActive" value="on" />
          ) : (
            <Checkbox name="isActive" defaultChecked={product.isActive} label="Buchbar" />
          )}
        </div>
        {errors.forPrivate ? <p className="text-sm font-medium text-danger-600">{errors.forPrivate[0]}</p> : null}
      </fieldset>

      {isListing ? (
        <input type="hidden" name="periodDays" value={product.periodDays} />
      ) : (
        <fieldset className="space-y-4 rounded-xl border border-line p-4">
          <legend className="px-1 text-sm font-semibold">Schutz vor Missbrauch</legend>
          <p className="text-xs text-ink-500">Leer lassen = ohne Grenze. Die Werte sind Entwicklungsstandards und keine endgültigen Geschäftsregeln.</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {isBump ? null : (
              <>
                <Field label="Gleichzeitig je Konto" error={errors.maxActivePerUser}>
                  <Input name="maxActivePerUser" inputMode="numeric" defaultValue={v('maxActivePerUser', int(product.maxActivePerUser))} />
                </Field>
                <Field label="Gleichzeitig insgesamt" error={errors.maxActiveTotal}>
                  <Input name="maxActiveTotal" inputMode="numeric" defaultValue={v('maxActiveTotal', int(product.maxActiveTotal))} />
                </Field>
              </>
            )}
            <Field label="Höchstens je Zeitraum" error={errors.maxPerPeriod}>
              <Input name="maxPerPeriod" inputMode="numeric" defaultValue={v('maxPerPeriod', int(product.maxPerPeriod))} />
            </Field>
            <Field label="Zeitraum (Tage)" error={errors.periodDays} required>
              <Input name="periodDays" inputMode="numeric" defaultValue={v('periodDays', int(product.periodDays))} />
            </Field>
            {isBump ? (
              <Field label="Mindestabstand (Stunden)" hint="Je Anzeige, ab Veröffentlichung bzw. letztem Hochschieben." error={errors.cooldownHours}>
                <Input name="cooldownHours" inputMode="numeric" defaultValue={v('cooldownHours', int(product.cooldownHours))} />
              </Field>
            ) : null}
          </div>
        </fieldset>
      )}
      {errors.expectedUpdatedAt ? <p className="text-sm font-medium text-danger-600">{errors.expectedUpdatedAt[0]}</p> : null}
      <SubmitButton>{product.name} speichern</SubmitButton>
    </form>
  );
}

/** Einführungsaktion und allgemeine Buchungsgrenze */
export function IntroSettingsForm({ settings }: { settings: BillingSettingsDto }) {
  const [state, action] = useActionState(updateBillingSettingsAction, initialFormState);
  const errors = state.fieldErrors ?? {};
  const v = (key: string, fallback: string) => state.values?.[key] ?? fallback;
  return (
    <form key={settings.updatedAt} action={action} className="space-y-5" noValidate>
      <StateAlert state={state} />
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Checkbox name="introEnabled" defaultChecked={settings.introEnabled} label="Einführungsaktion aktiv" />
        <Checkbox name="introVisible" defaultChecked={settings.introVisible} label="Auf der Website anzeigen" />
        <Checkbox name="introShowPlannedPrice" defaultChecked={settings.introShowPlannedPrice} label="Geplanten Standardpreis nennen" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Titel" error={errors.introTitle} required>
          <Input name="introTitle" maxLength={80} defaultValue={v('introTitle', settings.introTitle)} />
        </Field>
        <Field label="Buchungen je Konto und Stunde" hint="Grenze für Zusatzleistungen (Schutz vor Missbrauch)." error={errors.maxBookingsPerHour} required>
          <Input name="maxBookingsPerHour" inputMode="numeric" defaultValue={v('maxBookingsPerHour', String(settings.maxBookingsPerHour))} />
        </Field>
      </div>
      <Field label="Beschreibung" error={errors.introDescription} required>
        <Textarea name="introDescription" rows={2} maxLength={400} className="min-h-16" defaultValue={v('introDescription', settings.introDescription)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Beginn (optional)" error={errors.introStartsAt}>
          <Input name="introStartsAt" type="date" defaultValue={v('introStartsAt', startDay(settings.introStartsAt))} />
        </Field>
        <Field label="Ende einschließlich (optional)" hint="Ohne Ende wird keine Frist angezeigt. Das Ende schaltet nichts kostenpflichtig." error={errors.introEndsAt}>
          <Input name="introEndsAt" type="date" defaultValue={v('introEndsAt', endDay(settings.introEndsAt))} />
        </Field>
      </div>
      <SubmitButton>Einführungsaktion speichern</SubmitButton>
    </form>
  );
}

/** Betriebsmodus umschalten: kostenpflichtig nur mit wörtlicher Bestätigung und ohne offene Hindernisse */
export function BillingModeForm({ mode, blocked }: { mode: BillingMode; blocked: boolean }) {
  const [state, action] = useActionState(setBillingModeAction, initialFormState);
  const errors = state.fieldErrors ?? {};
  if (mode === 'PAID') {
    return (
      <form action={action} className="space-y-3">
        <StateAlert state={state} />
        <input type="hidden" name="mode" value="FREE" />
        <SubmitButton variant="outline">Zurück zum kostenlosen Betrieb</SubmitButton>
      </form>
    );
  }
  return (
    <form action={action} className="space-y-3">
      <StateAlert state={state} />
      <input type="hidden" name="mode" value="PAID" />
      <Field
        label={`Zum Einschalten ${PAID_MODE_CONFIRMATION} eintippen`}
        hint="Danach werden nur freigegebene Leistungen mit Preis verrechnet – nur für neue Buchungen, nie rückwirkend."
        error={errors.confirmation}
      >
        <Input name="confirmation" autoComplete="off" disabled={blocked} defaultValue="" />
      </Field>
      <SubmitButton variant="danger" disabled={blocked}>
        Kostenpflichtigen Betrieb einschalten
      </SubmitButton>
    </form>
  );
}
