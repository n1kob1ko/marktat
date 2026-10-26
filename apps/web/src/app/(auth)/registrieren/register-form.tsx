'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { Building2, User } from 'lucide-react';
import { Alert, Checkbox, cn, Field, Input } from '@marktat/ui';
import { SubmitButton } from '@/components/submit-button';
import { initialFormState } from '@/lib/form-state';
import { registerAction } from '../actions';

export function RegisterForm() {
  const [state, action] = useActionState(registerAction, initialFormState);
  const [accountType, setAccountType] = useState(state.values?.accountType ?? 'PRIVATE');

  if (state.status === 'success' && state.message) {
    return (
      <Alert tone="success" title="Bitte bestätige deine E-Mail-Adresse">
        {state.message}
      </Alert>
    );
  }

  return (
    <form action={action} className="space-y-5" noValidate>
      {state.message ? <Alert tone="danger">{state.message}</Alert> : null}

      <fieldset>
        <legend className="text-sm font-semibold text-ink-900">Kontoart</legend>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {[
            { value: 'PRIVATE', label: 'Privat', hint: 'Gelegentlich verkaufen', icon: User },
            { value: 'BUSINESS', label: 'Gewerblich', hint: 'Händler & Unternehmen', icon: Building2 },
          ].map((option) => (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer flex-col gap-1 rounded-xl border p-3.5 transition-colors has-focus-visible:ring-3 has-focus-visible:ring-brand-500/30',
                accountType === option.value ? 'border-brand-600 bg-brand-50' : 'border-line-strong hover:border-ink-400',
              )}
            >
              <input
                type="radio"
                name="accountType"
                value={option.value}
                checked={accountType === option.value}
                onChange={() => setAccountType(option.value)}
                className="sr-only"
              />
              <option.icon className="size-5 text-brand-700" aria-hidden="true" />
              <span className="font-semibold text-ink-900">{option.label}</span>
              <span className="text-xs text-ink-500">{option.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="Anzeigename" hint="Wird bei deinen Anzeigen angezeigt." error={state.fieldErrors?.displayName} required>
        <Input name="displayName" autoComplete="nickname" defaultValue={state.values?.displayName} maxLength={50} />
      </Field>

      {accountType === 'BUSINESS' ? (
        <Field
          label="Firmenname"
          hint="Gewerbliche Anbieter werden auf der Plattform als solche gekennzeichnet."
          error={state.fieldErrors?.companyName}
          required
        >
          <Input name="companyName" autoComplete="organization" defaultValue={state.values?.companyName} maxLength={120} />
        </Field>
      ) : null}

      <Field label="E-Mail-Adresse" error={state.fieldErrors?.email} required>
        <Input name="email" type="email" autoComplete="email" defaultValue={state.values?.email} />
      </Field>

      <Field label="Passwort" hint="Mindestens 10 Zeichen, mit Buchstaben und Ziffern." error={state.fieldErrors?.password} required>
        <Input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={72} />
      </Field>

      {/* Honeypot – für Menschen unsichtbar */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div>
        <Checkbox
          name="acceptTerms"
          label={
            <>
              Ich akzeptiere die{' '}
              <Link href="/agb" className="font-medium text-brand-700 underline" target="_blank">
                Nutzungsbedingungen
              </Link>{' '}
              und habe die{' '}
              <Link href="/datenschutz" className="font-medium text-brand-700 underline" target="_blank">
                Datenschutzerklärung
              </Link>{' '}
              gelesen.
            </>
          }
          aria-invalid={state.fieldErrors?.acceptTerms ? true : undefined}
          aria-describedby={state.fieldErrors?.acceptTerms ? 'terms-error' : undefined}
        />
        {state.fieldErrors?.acceptTerms ? (
          <p id="terms-error" className="mt-1.5 text-sm font-medium text-danger-600">
            {state.fieldErrors.acceptTerms[0]}
          </p>
        ) : null}
      </div>

      <SubmitButton className="w-full" size="lg">
        Konto erstellen
      </SubmitButton>
    </form>
  );
}
