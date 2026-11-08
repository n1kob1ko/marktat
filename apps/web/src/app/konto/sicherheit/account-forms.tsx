'use client';

import { useActionState } from 'react';
import { Alert, Checkbox, Field, Input } from '@marktat/ui';
import { Captcha } from '@/components/captcha';
import { SubmitButton } from '@/components/submit-button';
import { initialFormState } from '@/lib/form-state';
import { changeEmailAction, changePasswordAction } from './actions';

export function ChangePasswordForm() {
  const [state, action] = useActionState(changePasswordAction, initialFormState);
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <Field label="Aktuelles Passwort" error={state.fieldErrors?.currentPassword} required>
        <Input name="currentPassword" type="password" autoComplete="current-password" maxLength={72} />
      </Field>
      <Field label="Neues Passwort" hint="Mindestens 10 Zeichen, mit Buchstaben und Ziffern." error={state.fieldErrors?.password} required>
        <Input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={72} />
      </Field>
      <Field label="Neues Passwort wiederholen" error={state.fieldErrors?.passwordConfirm} required>
        <Input name="passwordConfirm" type="password" autoComplete="new-password" />
      </Field>
      <Checkbox
        name="signOutOthers"
        defaultChecked
        label={
          <>
            <span className="font-semibold text-ink-900">Alle anderen Geräte abmelden</span>
            <br />
            Empfohlen, falls du dich irgendwo angemeldet hast, wo du nicht mehr bist. Dieses Gerät bleibt angemeldet.
          </>
        }
      />
      <Captcha />
      <SubmitButton>Passwort ändern</SubmitButton>
    </form>
  );
}

export function ChangeEmailForm({ currentEmail, pendingEmail }: { currentEmail: string; pendingEmail: string | null }) {
  const [state, action] = useActionState(changeEmailAction, initialFormState);
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      {pendingEmail ? (
        <Alert tone="info">
          Die Änderung zu <span className="font-semibold">{pendingEmail}</span> wartet noch auf Bestätigung. Öffne die Links in beiden E-Mails – an die bisherige
          und an die neue Adresse. Gibst du unten eine Adresse ein, schicken wir die Links neu.
        </Alert>
      ) : null}
      <p className="text-sm text-ink-600">
        Aktuell: <span className="font-semibold text-ink-900">{currentEmail}</span>
      </p>
      <Field label="Neue E-Mail-Adresse" error={state.fieldErrors?.email} required>
        <Input name="email" type="email" autoComplete="email" defaultValue={state.values?.email ?? pendingEmail ?? ''} />
      </Field>
      <Field label="Passwort" hint="Zur Bestätigung, dass du es bist." error={state.fieldErrors?.password} required>
        <Input name="password" type="password" autoComplete="current-password" maxLength={72} />
      </Field>
      <Captcha />
      <SubmitButton variant="outline">Bestätigungslinks schicken</SubmitButton>
    </form>
  );
}
