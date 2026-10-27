'use client';

import { useActionState } from 'react';
import { Alert, Checkbox, Field, Textarea } from '@marktat/ui';
import { REPORT_REASON_HINTS, REPORT_REASON_LABELS, REPORT_REASONS } from '@marktat/shared';
import { initialFormState } from '@/lib/form-state';
import { SubmitButton } from '@/components/submit-button';
import { reportListingAction } from './actions';

/** Meldeformular nach Art. 16 DSA: Grund, Begründung, Erklärung nach Treu und Glauben. */
export function ReportListingForm({ listingId }: { listingId: string }) {
  const [state, action] = useActionState(reportListingAction, initialFormState);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5">
      {state.status === 'error' && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <input type="hidden" name="listingId" value={listingId} />
      <fieldset>
        <legend className="text-sm font-semibold text-ink-900">
          Was stimmt nicht?<span className="ml-0.5 text-danger-600" aria-hidden="true">*</span>
        </legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {REPORT_REASONS.map((reason) => (
            <label
              key={reason}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 hover:border-line-strong has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50/50"
            >
              <input type="radio" name="reason" value={reason} defaultChecked={state.values?.reason === reason} required className="mt-0.5 size-4 shrink-0 accent-brand-700" />
              <span className="text-sm">
                <span className="font-semibold text-ink-900">{REPORT_REASON_LABELS[reason]}</span>
                <span className="block text-ink-500">{REPORT_REASON_HINTS[reason]}</span>
              </span>
            </label>
          ))}
        </div>
        {errors.reason ? <p className="mt-1 text-sm font-medium text-danger-600">Bitte wähle einen Grund.</p> : null}
      </fieldset>
      <Field
        label="Begründung"
        hint="Beschreibe möglichst konkret, warum die Anzeige gegen Regeln oder Gesetze verstößt (mindestens 10 Zeichen)."
        error={errors.details}
        required
      >
        <Textarea name="details" rows={5} minLength={10} maxLength={1000} defaultValue={state.values?.details} />
      </Field>
      <div>
        <Checkbox name="goodFaith" required label="Ich bestätige, dass meine Angaben nach bestem Wissen richtig und vollständig sind." />
        {errors.goodFaith ? <p className="mt-1 text-sm font-medium text-danger-600">{errors.goodFaith[0]}</p> : null}
      </div>
      <p className="text-xs leading-relaxed text-ink-500">
        Ein Mensch aus unserem Team prüft jede Meldung. Die Anbieterin bzw. der Anbieter erfährt nicht, wer gemeldet hat. Über das Ergebnis informieren wir dich in deinem Konto unter
        „Mitteilungen“. Bei akuter Gefahr wende dich bitte direkt an die Polizei (133).
      </p>
      <SubmitButton variant="danger">Meldung senden</SubmitButton>
    </form>
  );
}
