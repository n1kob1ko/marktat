'use client';

import { useActionState } from 'react';
import { Alert, Field, Input } from '@marktat/ui';
import { SubmitButton } from '@/components/submit-button';
import { initialFormState } from '@/lib/form-state';
import { forgotPasswordAction } from '../actions';

export function ForgotPasswordForm() {
  const [state, action] = useActionState(forgotPasswordAction, initialFormState);
  if (state.status === 'success') return <Alert tone="success">{state.message}</Alert>;
  return (
    <form action={action} className="space-y-5" noValidate>
      {state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <Field label="E-Mail-Adresse" error={state.fieldErrors?.email} required>
        <Input name="email" type="email" autoComplete="email" defaultValue={state.values?.email} />
      </Field>
      <SubmitButton className="w-full" size="lg">
        Link anfordern
      </SubmitButton>
    </form>
  );
}
