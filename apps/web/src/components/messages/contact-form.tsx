'use client';

import { useActionState, useRef } from 'react';
import { MessageCircle } from 'lucide-react';
import { MESSAGE_MAX_LENGTH } from '@marktat/shared';
import { Alert, Textarea } from '@marktat/ui';
import { initialFormState } from '@/lib/form-state';
import { startConversationAction } from '@/app/nachrichten/actions';
import { SubmitButton } from '@/components/submit-button';
import { ClientIdField } from '@/components/client-id-field';

const SUGGESTIONS = ['Ist die Anzeige noch verfügbar?', 'Ist der Preis verhandelbar?', 'Wann könnte ich es mir ansehen?'];
const SERVICE_SUGGESTIONS = ['Hätten Sie in den nächsten Wochen Zeit?', 'Können Sie mir ein unverbindliches Angebot machen?', 'Arbeiten Sie auch bei mir vor Ort?'];
const PROJECT_SUGGESTIONS = ['Ich hätte im genannten Zeitraum Zeit.', 'Ähnliche Projekte finden Sie in meinem Anbieterprofil.', 'Darf ich ein paar Fragen zum Umfang stellen?'];

/** Erste Nachricht direkt auf der Detailseite (Inserat, Anbieterprofil oder Antwort auf einen Projektauftrag) – danach geht es in den Chat. */
export function ContactForm({ listingId, serviceProfileId, projectId, sellerName }: { listingId?: string; serviceProfileId?: string; projectId?: string; sellerName: string }) {
  const [state, action] = useActionState(startConversationAction, initialFormState);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const error = state.fieldErrors?.body?.[0];

  function suggest(text: string) {
    const el = textarea.current;
    if (!el) return;
    el.value = el.value.trim() ? `${el.value.trim()}\n${text}` : text;
    el.focus();
  }
  return (
    <form action={action} className="mt-5 space-y-3" id="nachricht">
      {listingId ? <input type="hidden" name="listingId" value={listingId} /> : null}
      {serviceProfileId ? <input type="hidden" name="serviceProfileId" value={serviceProfileId} /> : null}
      {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
      <ClientIdField name="clientId" />
      {state.status === 'error' && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <div className="space-y-1.5">
        <label htmlFor="contact-body" className="block text-sm font-semibold text-ink-900">
          Nachricht an {sellerName}
        </label>
        <ul className="flex flex-wrap gap-1.5" aria-label="Vorschläge">
          {(projectId ? PROJECT_SUGGESTIONS : serviceProfileId ? SERVICE_SUGGESTIONS : SUGGESTIONS).map((text) => (
            <li key={text}>
              <button
                type="button"
                onClick={() => suggest(text)}
                className="rounded-full border border-line-strong bg-surface px-3 py-1 text-xs font-medium text-ink-700 hover:border-brand-400 hover:bg-brand-50 hover:text-brand-900"
              >
                {text}
              </button>
            </li>
          ))}
        </ul>
        <Textarea
          ref={textarea}
          id="contact-body"
          name="body"
          required
          maxLength={MESSAGE_MAX_LENGTH}
          placeholder={projectId ? 'Hallo, ich kann Ihnen bei diesem Vorhaben helfen …' : serviceProfileId ? 'Hallo, ich suche Unterstützung bei …' : 'Hallo, ist die Anzeige noch verfügbar?'}
          defaultValue={state.values?.body}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'contact-error' : undefined}
          className="min-h-28"
        />
        {error ? (
          <p id="contact-error" className="text-sm font-medium text-danger-600">
            {error}
          </p>
        ) : null}
      </div>
      <SubmitButton className="w-full" size="lg">
        <MessageCircle className="size-5" aria-hidden="true" /> Nachricht senden
      </SubmitButton>
    </form>
  );
}
