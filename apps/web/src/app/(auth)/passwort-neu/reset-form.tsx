'use client';

import { useActionState } from 'react';
import { Alert, Field, Input } from '@marktat/ui';
import { SubmitButton } from '@/components/submit-button';
import { initialFormState } from '@/lib/form-state';
import { resetPasswordAction } from '../actions';

export function ResetPasswordForm() {
  const [state, action] = useActionState(resetPasswordAction, initialFormState);
  return (
    <form action={action} className="space-y-5" noValidate>
      {state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <Field label="Neues Passwort" hint="Mindestens 10 Zeichen, mit Buchstaben und Ziffern." error={state.fieldErrors?.password} required>
        <Input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={72} />
      </Field>
      <Field label="Passwort wiederholen" error={state.fieldErrors?.passwordConfirm} required>
        <Input name="passwordConfirm" type="password" autoComplete="new-password" />
      </Field>
      <SubmitButton className="w-full" size="lg">
        Passwort speichern
      </SubmitButton>
    </form>
  );
}
