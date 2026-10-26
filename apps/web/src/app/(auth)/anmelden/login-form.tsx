'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Alert, Field, Input } from '@marktat/ui';
import { SubmitButton } from '@/components/submit-button';
import { initialFormState } from '@/lib/form-state';
import { loginAction } from '../actions';

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(loginAction, initialFormState);
  return (
    <form action={action} className="space-y-5" noValidate>
      {state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <input type="hidden" name="weiter" value={next ?? '/konto'} />
      <Field label="E-Mail-Adresse" error={state.fieldErrors?.email} required>
        <Input name="email" type="email" autoComplete="email" defaultValue={state.values?.email} />
      </Field>
      <Field label="Passwort" error={state.fieldErrors?.password} required>
        <Input name="password" type="password" autoComplete="current-password" />
      </Field>
      <div className="flex justify-end">
        <Link href="/passwort-vergessen" className="text-sm font-medium text-brand-700 hover:underline">
          Passwort vergessen?
        </Link>
      </div>
      <SubmitButton className="w-full" size="lg">
        Anmelden
      </SubmitButton>
    </form>
  );
}
