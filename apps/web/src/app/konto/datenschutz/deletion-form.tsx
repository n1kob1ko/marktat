'use client';

import { useActionState, useState } from 'react';
import { Alert, Button, Field, Input } from '@marktat/ui';
import { DELETE_CONFIRMATION_WORD } from '@marktat/shared';
import { initialFormState } from '@/lib/form-state';
import { SubmitButton } from '@/components/submit-button';
import { deleteAccountAction } from './actions';

/** Zweistufig: erst aufklappen, dann Passwort und Bestätigungswort. Kein Browser-Dialog. */
export function DeletionForm() {
  const [state, action] = useActionState(deleteAccountAction, initialFormState);
  const [open, setOpen] = useState(state.status === 'error');
  if (!open) {
    return (
      <Button variant="outline" className="text-danger-700" onClick={() => setOpen(true)}>
        Konto löschen …
      </Button>
    );
  }
  return (
    <form action={action} className="space-y-4">
      {state.status === 'error' && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <Field label="Dein Passwort" hint="Zur Sicherheit melden wir dich damit erneut an." error={state.fieldErrors?.password} required>
        <Input name="password" type="password" autoComplete="current-password" />
      </Field>
      <Field label={`Tippe ${DELETE_CONFIRMATION_WORD} zur Bestätigung`} error={state.fieldErrors?.confirmation} required>
        <Input name="confirmation" autoComplete="off" defaultValue={state.values?.confirmation} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="danger">Konto endgültig löschen</SubmitButton>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Abbrechen
        </Button>
      </div>
    </form>
  );
}
