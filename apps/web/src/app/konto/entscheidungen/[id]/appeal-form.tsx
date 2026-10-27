'use client';

import { useActionState } from 'react';
import { Alert, Field, Textarea } from '@marktat/ui';
import { initialFormState } from '@/lib/form-state';
import { SubmitButton } from '@/components/submit-button';
import { appealAction } from './actions';

export function AppealForm({ decisionId }: { decisionId: string }) {
  const [state, action] = useActionState(appealAction, initialFormState);
  return (
    <form action={action} className="space-y-4">
      {state.status === 'error' && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <input type="hidden" name="decisionId" value={decisionId} />
      <Field label="Begründung deines Einspruchs" hint="Mindestens 20 Zeichen. Du kannst z. B. erklären, was missverstanden wurde oder was du geändert hast." error={state.fieldErrors?.body} required>
        <Textarea name="body" rows={5} minLength={20} maxLength={2000} defaultValue={state.values?.body} />
      </Field>
      <SubmitButton>Einspruch einreichen</SubmitButton>
    </form>
  );
}
