'use client';

import Link from 'next/link';
import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { Ban, ExternalLink, Flag, MoreVertical, X } from 'lucide-react';
import { CONVERSATION_REPORT_REASONS, REPORT_REASON_LABELS, type ConversationDetail } from '@marktat/shared';
import { Alert, Button, Textarea, buttonClasses } from '@marktat/ui';
import { initialFormState } from '@/lib/form-state';
import { blockUserAction, reportUserAction } from '@/app/nachrichten/actions';
import { SubmitButton } from '@/components/submit-button';

const itemClasses =
  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-ink-800 hover:bg-ink-900/5 focus-visible:bg-ink-900/5 focus-visible:outline-none';

/** Menü im Chat-Kopf: Anzeige öffnen, blockieren, melden */
export function ChatMenu({ conversation }: { conversation: ConversationDetail }) {
  const [open, setOpen] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reporting, setReporting] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const { partner } = conversation;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) {
        setOpen(false);
        setConfirmBlock(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="Weitere Aktionen"
        className="flex size-10 items-center justify-center rounded-xl text-ink-700 hover:bg-ink-900/5"
      >
        <MoreVertical className="size-5" aria-hidden="true" />
      </button>
      {open ? (
        <div id={menuId} className="absolute top-11 right-0 z-30 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-lg">
          <Link href={conversation.subject.href} className={itemClasses} onClick={() => setOpen(false)}>
            <ExternalLink className="size-4 text-ink-500" aria-hidden="true" /> {{ listing: 'Anzeige ansehen', service: 'Anbieterprofil ansehen', project: 'Projektauftrag ansehen' }[conversation.subject.kind]}
          </Link>
          {partner.inactive ? null : conversation.blockedByMe ? (
            <form action={blockUserAction}>
              <input type="hidden" name="userId" value={partner.id} />
              <input type="hidden" name="conversationId" value={conversation.id} />
              <button name="action" value="unblock" className={itemClasses}>
                <Ban className="size-4 text-ink-500" aria-hidden="true" /> Blockierung aufheben
              </button>
            </form>
          ) : confirmBlock ? (
            <form action={blockUserAction} className="space-y-2 rounded-lg bg-danger-50 p-3">
              <p className="text-xs leading-relaxed text-danger-700">
                Ihr könnt euch dann gegenseitig keine Nachrichten mehr schicken. Du kannst das jederzeit wieder aufheben.
              </p>
              <input type="hidden" name="userId" value={partner.id} />
              <input type="hidden" name="conversationId" value={conversation.id} />
              <div className="flex gap-2">
                <SubmitButton name="action" value="block" variant="danger" size="sm">
                  Blockieren
                </SubmitButton>
                <Button size="sm" variant="ghost" onClick={() => setConfirmBlock(false)}>
                  Abbrechen
                </Button>
              </div>
            </form>
          ) : (
            <button type="button" className={itemClasses} onClick={() => setConfirmBlock(true)}>
              <Ban className="size-4 text-ink-500" aria-hidden="true" /> {partner.displayName} blockieren
            </button>
          )}
          <button
            type="button"
            className={`${itemClasses} text-danger-700`}
            onClick={() => {
              setOpen(false);
              setReporting(true);
            }}
          >
            <Flag className="size-4" aria-hidden="true" /> {partner.displayName} melden
          </button>
        </div>
      ) : null}
      {reporting ? <ReportDialog conversation={conversation} onClose={() => setReporting(false)} /> : null}
    </div>
  );
}

function ReportDialog({ conversation, onClose }: { conversation: ConversationDetail; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action] = useActionState(reportUserAction, initialFormState);
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
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-[var(--radius-card)] border border-line bg-surface p-0 text-ink-900 shadow-xl backdrop:bg-ink-950/40"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 id={titleId} className="font-sans text-lg font-semibold tracking-normal">
          {conversation.partner.displayName} melden
        </h2>
        <button type="button" onClick={() => dialog.current?.close()} className="flex size-9 items-center justify-center rounded-lg hover:bg-ink-900/5" aria-label="Schließen">
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      {state.status === 'success' ? (
        <div className="space-y-4 p-5">
          <Alert tone="success">{state.message}</Alert>
          <p className="text-sm text-ink-600">Wenn du keine weiteren Nachrichten möchtest, kannst du die Person zusätzlich blockieren.</p>
          <button type="button" onClick={() => dialog.current?.close()} className={buttonClasses({ className: 'w-full' })}>
            Fertig
          </button>
        </div>
      ) : (
        <form action={action} className="space-y-4 p-5">
          <input type="hidden" name="conversationId" value={conversation.id} />
          {state.status === 'error' && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
          <fieldset>
            <legend className="text-sm font-semibold text-ink-900">Was ist passiert?</legend>
            <div className="mt-2 space-y-1">
              {CONVERSATION_REPORT_REASONS.map((reason) => (
                <label key={reason} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-canvas">
                  <input type="radio" name="reason" value={reason} defaultChecked={state.values?.reason === reason} required className="size-4 accent-brand-700" />
                  {REPORT_REASON_LABELS[reason]}
                </label>
              ))}
            </div>
            {state.fieldErrors?.reason ? <p className="mt-1 text-sm font-medium text-danger-600">Bitte wähle einen Grund.</p> : null}
          </fieldset>
          <div className="space-y-1.5">
            <label htmlFor="report-details" className="block text-sm font-semibold text-ink-900">
              Details <span className="font-normal text-ink-500">(optional)</span>
            </label>
            <Textarea id="report-details" name="details" maxLength={1000} defaultValue={state.values?.details} className="min-h-24" />
            {state.fieldErrors?.details ? <p className="text-sm font-medium text-danger-600">{state.fieldErrors.details[0]}</p> : null}
          </div>
          <p className="text-xs text-ink-500">Unser Team prüft die Meldung und sieht dafür bei Bedarf die Nachrichten bis zu diesem Zeitpunkt ein. Du erfährst per Mitteilung, wie wir entschieden haben.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => dialog.current?.close()}>
              Abbrechen
            </Button>
            <SubmitButton variant="danger">Meldung senden</SubmitButton>
          </div>
        </form>
      )}
    </dialog>
  );
}
