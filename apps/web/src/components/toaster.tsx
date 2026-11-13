'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Undo2 } from 'lucide-react';
import { cn } from '@marktat/ui';
import { usePresence } from '@/lib/motion';
import { currentToast, runToastAction, settleToast, subscribeToast, type Toast } from '@/lib/toast';
import { Kbd, useModKey } from './kbd';

/**
 * Zeigt den aktuellen Hinweis (lib/toast.ts) unten in der Bildmitte – über dem festen Kontakt-Balken am Handy.
 * Die Zeit läuft nicht weiter, solange der Zeiger darauf ruht oder der Knopf den Fokus hat.
 * Strg+Z (⌘Z) löst „Rückgängig“ aus, solange gerade kein Textfeld bearbeitet wird.
 */
export function Toaster() {
  const toast = useSyncExternalStore(subscribeToast, currentToast, () => null);
  // Der letzte Hinweis bleibt während des Ausblendens sichtbar
  const [shown, setShown] = useState<Toast | null>(null);
  if (toast && toast !== shown) setShown(toast);
  const presence = usePresence(toast !== null);
  // Angehalten ist immer nur ein bestimmter Hinweis: Verschwindet er unter dem Zeiger (Klick auf „Rückgängig“),
  // kommt kein „Zeiger weg“ mehr – der nächste Hinweis darf davon nicht stehen bleiben
  const [pausedId, setPausedId] = useState<number | null>(null);
  const paused = toast !== null && pausedId === toast.id;
  const remaining = useRef(0);
  const mod = useModKey();

  useEffect(() => {
    if (toast) remaining.current = toast.duration;
  }, [toast]);

  useEffect(() => {
    if (!toast || paused) return;
    const startedAt = performance.now();
    const timer = setTimeout(() => settleToast(toast.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(remaining.current - (performance.now() - startedAt), 800);
    };
  }, [toast, paused]);

  useEffect(() => {
    if (!toast) return;
    // Seite wird verlassen oder in den Hintergrund gelegt: nicht auf den Ablauf warten
    const onHide = () => {
      if (document.visibilityState === 'hidden') settleToast(toast.id);
    };
    const onPageHide = () => settleToast(toast.id);
    const onKey = (event: KeyboardEvent) => {
      if (!toast.actionLabel || event.key.toLowerCase() !== 'z' || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      runToastAction(toast.id);
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('keydown', onKey);
    };
  }, [toast]);

  const visible = presence.present ? shown : null;

  return (
    <div className="toast-region pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4" role="status" aria-live="polite">
      {visible ? (
        <div
          key={visible.id}
          data-state={presence.state}
          data-testid="toast"
          onPointerEnter={() => setPausedId(visible.id)}
          onPointerLeave={() => setPausedId(null)}
          onFocus={() => setPausedId(visible.id)}
          onBlur={() => setPausedId(null)}
          className={cn(
            'pop enter pointer-events-auto flex max-w-full origin-bottom items-center gap-1 rounded-2xl py-1.5 pr-1.5 pl-4 text-sm font-medium text-white shadow-[var(--shadow-card-hover)]',
            visible.tone === 'danger' ? 'bg-danger-fill' : 'bg-tooltip',
          )}
        >
          <span className="min-w-0 py-1.5 pr-2">{visible.message}</span>
          {visible.actionLabel ? (
            <button
              type="button"
              onClick={() => runToastAction(visible.id)}
              className="press tap relative flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-white/12 px-3 font-semibold text-accent-300 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <Undo2 className="size-4" aria-hidden="true" />
              {visible.actionLabel}
              {mod ? (
                <Kbd className="ml-1 hidden border-white/25 bg-transparent text-white/70 [@media(hover:hover)]:inline-flex">{mod} Z</Kbd>
              ) : null}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
