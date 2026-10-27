'use client';

import { useActionState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { initialFormState } from '@/lib/form-state';
import { resolveErrorAction } from '../actions';

export function ResolveErrorButton({ id }: { id: string }) {
  const [state, action] = useActionState(resolveErrorAction, initialFormState);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" size="sm">
        Erledigt
      </SubmitButton>
      {state.message && state.status === 'error' ? <p className="text-xs text-danger-600">{state.message}</p> : null}
    </form>
  );
}
