'use client';

import { useActionState } from 'react';
import { Alert, Checkbox } from '@marktat/ui';
import { initialFormState } from '@/lib/form-state';
import { SubmitButton } from '@/components/submit-button';
import { updateNotificationsAction } from './actions';

export function NotificationSettingsForm({ messages, searches, email }: { messages: boolean; searches: boolean; email: string }) {
  const [state, action] = useActionState(updateNotificationsAction, initialFormState);
  return (
    <form action={action} className="space-y-5">
      {state.status !== 'idle' && state.message ? <Alert tone={state.status === 'success' ? 'success' : 'danger'}>{state.message}</Alert> : null}
      <p className="text-sm text-ink-600">
        E-Mails gehen an <span className="font-semibold text-ink-900">{email}</span>.
      </p>
      <Checkbox
        name="notifyMessagesByEmail"
        defaultChecked={messages}
        label={
          <>
            <span className="font-semibold text-ink-900">Neue Nachrichten</span>
            <br />
            Eine E-Mail, wenn dir jemand schreibt und du die Nachricht nicht innerhalb weniger Minuten liest. Höchstens eine je Unterhaltung, bis du sie gelesen hast.
          </>
        }
      />
      <Checkbox
        name="notifySearchesByEmail"
        defaultChecked={searches}
        label={
          <>
            <span className="font-semibold text-ink-900">Neue Treffer für gespeicherte Suchen</span>
            <br />
            Gilt für alle Suchen, bei denen die Glocke eingeschaltet ist. Wir fassen neue Anzeigen in einer E-Mail zusammen.
          </>
        }
      />
      <SubmitButton>Einstellungen speichern</SubmitButton>
    </form>
  );
}
