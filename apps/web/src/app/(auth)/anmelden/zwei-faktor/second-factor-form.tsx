'use client';

import { useActionState } from 'react';
import { Alert, Field, Input } from '@marktat/ui';
import { SubmitButton } from '@/components/submit-button';
import { initialFormState } from '@/lib/form-state';
import { verifySecondFactorAction } from '../../actions';

export function SecondFactorForm({ next }: { next: string }) {
  const [state, action] = useActionState(verifySecondFactorAction, initialFormState);
  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="weiter" value={next} />
      <Field
        label="Bestätigungscode"
        hint="Der Code wechselt alle 30 Sekunden. Kein Zugriff auf die App? Wende dich an eine Administratorin bzw. einen Administrator."
        error={state.fieldErrors?.code}
        required
      >
        <Input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          className="text-center font-mono text-xl tracking-[0.3em]"
          autoFocus
        />
      </Field>
      {state.message && !state.fieldErrors?.code ? <Alert tone="danger">{state.message}</Alert> : null}
      <SubmitButton className="w-full" size="lg">
        Bestätigen
      </SubmitButton>
    </form>
  );
}
