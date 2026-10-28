'use client';

import Link from 'next/link';
import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { BellPlus, Bookmark, X } from 'lucide-react';
import { Alert, Button, Checkbox, Field, Input, buttonClasses } from '@marktat/ui';
import type { SavedSearchKind } from '@marktat/shared';
import { initialFormState } from '@/lib/form-state';
import { SAVED_SEARCH_NOTIFY_LABEL } from '@/lib/saved-searches';
import { saveSearchAction } from '@/app/konto/suchen/actions';
import { SubmitButton } from '@/components/submit-button';

interface SaveSearchButtonProps {
  /** Anzeigen (Standard), Deals oder Anbieterprofile */
  kind?: SavedSearchKind;
  /** Kanonische Such-Parameter (ohne Seite) */
  params: Record<string, string>;
  /** Kurzbeschreibung der Filter für die Liste „Gespeicherte Suchen“ */
  labels: string[];
  defaultName: string;
  returnTo: string;
}

/** Speichert die aktuelle Suche mit allen Filtern – optional mit E-Mail bei neuen Treffern. */
export function SaveSearchButton(props: SaveSearchButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="h-10">
        <Bookmark className="size-4" aria-hidden="true" /> Suche speichern
      </Button>
      {open ? <SaveSearchDialog {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SaveSearchDialog({ kind = 'LISTINGS', params, labels, defaultName, returnTo, onClose }: SaveSearchButtonProps & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action] = useActionState(saveSearchAction, initialFormState);
  const titleId = useId();

  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      // Nur echtes Schließen zählt (StrictMode öffnet den Dialog im Entwicklungsmodus zweimal)
      onClose={() => {
        if (!dialog.current?.open) onClose();
      }}
      aria-labelledby={titleId}
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-[var(--radius-card)] border border-line bg-surface p-0 text-ink-900 shadow-xl backdrop:bg-ink-950/40"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 id={titleId} className="font-sans text-lg font-semibold tracking-normal">
          Suche speichern
        </h2>
        <button type="button" onClick={() => dialog.current?.close()} className="flex size-9 items-center justify-center rounded-lg hover:bg-ink-900/5" aria-label="Schließen">
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      {state.status === 'success' ? (
        <div className="space-y-4 p-5">
          <Alert tone="success">{state.message}</Alert>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <button type="button" onClick={() => dialog.current?.close()} className={buttonClasses({ className: 'flex-1' })}>
              Weiter suchen
            </button>
            <Link href="/konto/suchen" className={buttonClasses({ variant: 'outline', className: 'flex-1' })}>
              Gespeicherte Suchen
            </Link>
          </div>
        </div>
      ) : (
        <form action={action} className="space-y-4 p-5">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="params" value={JSON.stringify(params)} />
          <input type="hidden" name="labels" value={JSON.stringify(labels)} />
          <input type="hidden" name="returnTo" value={returnTo} />
          {state.status === 'error' && state.message ? (
            <Alert tone="danger">
              {state.message}{' '}
              {state.message.includes('bereits') ? (
                <Link href="/konto/suchen" className="font-semibold underline">
                  Zu deinen Suchen
                </Link>
              ) : null}
            </Alert>
          ) : null}
          {labels.length ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="Filter dieser Suche">
              {labels.map((label) => (
                <li key={label} className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-900">
                  {label}
                </li>
              ))}
            </ul>
          ) : null}
          <Field label="Name" error={state.fieldErrors?.name} hint="So erscheint die Suche in deinem Konto.">
            <Input name="name" maxLength={80} required defaultValue={state.values?.name ?? defaultName} autoFocus />
          </Field>
          <Checkbox
            name="notify"
            defaultChecked
            label={
              <>
                <BellPlus className="mr-1 inline size-4 align-text-bottom text-brand-700" aria-hidden="true" />
                {SAVED_SEARCH_NOTIFY_LABEL[kind]}
              </>
            }
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => dialog.current?.close()}>
              Abbrechen
            </Button>
            <SubmitButton>Speichern</SubmitButton>
          </div>
        </form>
      )}
    </dialog>
  );
}
