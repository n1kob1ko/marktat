'use client';

import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@marktat/ui';
import { MOTION } from '@/lib/motion';

/**
 * Dialog in der Bildschirmmitte (natives <dialog>): Escape, Fokusfalle und abgedunkelter Hintergrund kommen vom Browser.
 * Blendet ein und aus (motion.css: dialog.modal); `onClose` wird erst gerufen, wenn der Dialog ausgeblendet ist.
 * Eigene Knöpfe im Inhalt schließen ihn mit `onClick={closeDialog}`.
 */
/** Schließt den Dialog, in dem der angeklickte Knopf sitzt */
export function closeDialog(event: MouseEvent<HTMLElement>) {
  event.currentTarget.closest('dialog')?.close();
}

export function ModalDialog({
  title,
  onClose,
  children,
  className,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Breite, z. B. w-[min(30rem,calc(100vw-2rem))] */
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const titleId = useId();

  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => {
      clearTimeout(timer.current);
      el?.close();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      // Nur echtes Schließen zählt (StrictMode öffnet den Dialog im Entwicklungsmodus zweimal)
      onClose={() => {
        if (dialog.current?.open) return;
        clearTimeout(timer.current);
        timer.current = setTimeout(onClose, MOTION.modalExit);
      }}
      aria-labelledby={titleId}
      className={cn('modal m-auto rounded-[var(--radius-card)] border border-line bg-surface p-0 text-ink-900 shadow-xl', className)}
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 id={titleId} className="font-sans text-lg font-semibold tracking-normal">
          {title}
        </h2>
        <button type="button" onClick={closeDialog} className="press flex size-9 items-center justify-center rounded-lg hover:bg-ink-900/5" aria-label="Schließen">
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
