'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { BellPlus, Bookmark } from 'lucide-react';
import { Alert, Button, Checkbox, Field, Input, buttonClasses } from '@marktat/ui';
import type { SavedSearchKind } from '@marktat/shared';
import { initialFormState } from '@/lib/form-state';
import { SAVED_SEARCH_NOTIFY_LABEL } from '@/lib/saved-searches';
import { saveSearchAction } from '@/app/konto/suchen/actions';
import { ModalDialog, closeDialog } from '@/components/modal-dialog';
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
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="h-10 max-lg:h-11">
        <Bookmark className="size-4" aria-hidden="true" /> Suche speichern
      </Button>
      {open ? <SaveSearchDialog {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SaveSearchDialog({ kind = 'LISTINGS', params, labels, defaultName, returnTo, onClose }: SaveSearchButtonProps & { onClose: () => void }) {
  const [state, action] = useActionState(saveSearchAction, initialFormState);

  return (
    <ModalDialog title="Suche speichern" onClose={onClose} className="w-[min(30rem,calc(100vw-2rem))]">
      {state.status === 'success' ? (
        <div className="stagger settle space-y-4 p-5">
          <Alert tone="success">{state.message}</Alert>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <button type="button" onClick={closeDialog} className={buttonClasses({ className: 'flex-1' })}>
              Weiter suchen
            </button>
            <Link href="/konto/suchen" className={buttonClasses({ variant: 'outline', className: 'flex-1' })}>
              Gespeicherte Suchen
            </Link>
          </div>
        </div>
      ) : (
        <form action={action} className="stagger settle space-y-4 p-5">
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
            <Button variant="ghost" onClick={closeDialog}>
              Abbrechen
            </Button>
            <SubmitButton>Speichern</SubmitButton>
          </div>
          {/* Am Ende, damit die sichtbaren Zeilen der Reihe nach erscheinen */}
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="params" value={JSON.stringify(params)} />
          <input type="hidden" name="labels" value={JSON.stringify(labels)} />
          <input type="hidden" name="returnTo" value={returnTo} />
        </form>
      )}
    </ModalDialog>
  );
}
