'use client';

import { useActionState } from 'react';
import { Alert } from '@marktat/ui';
import { resendConfirmationAction } from '@/app/(auth)/actions';
import { Captcha } from '@/components/captcha';
import { SubmitButton } from '@/components/submit-button';
import { initialFormState } from '@/lib/form-state';

/** „Bestätigungs-E-Mail nochmal senden“ – für alle, bei denen die erste Mail nicht angekommen ist */
export function ResendConfirmation({ email, next }: { email: string; next?: string }) {
  const [state, action] = useActionState(resendConfirmationAction, initialFormState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="email" value={email} />
      {next ? <input type="hidden" name="weiter" value={next} /> : null}
      {state.status === 'success' && state.message ? <Alert tone="success">{state.message}</Alert> : null}
      {state.status === 'error' && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <Captcha />
      <SubmitButton variant="outline" className="w-full">
        {state.status === 'success' ? 'Nochmal senden' : 'Bestätigungs-E-Mail nochmal senden'}
      </SubmitButton>
    </form>
  );
}
