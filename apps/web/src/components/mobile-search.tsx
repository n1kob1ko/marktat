'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { Swap, buttonClasses, cn } from '@marktat/ui';
import { usePresence } from '@/lib/motion';

/** Platzhalter beim Vorrendern (usePathname ist erst zur Laufzeit bekannt): dieselbe Lupe, noch ohne Funktion */
export function MobileSearchFallback() {
  return (
    <span aria-hidden="true" className={buttonClasses({ variant: 'ghost', size: 'sm', className: 'w-10 px-0 md:hidden' })}>
      <Search className="size-5" />
    </span>
  );
}

/**
 * Suche im Kopf für schmale Bildschirme (unter 768 px): eine Lupe klappt ein Suchfeld unter dem Kopf auf.
 * Am Desktop steht das Suchfeld direkt im Kopf (site-header.tsx). Funktioniert als GET-Formular auf /suche.
 */
export function MobileSearch({ className }: { className?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const pathname = usePathname();
  // Offen nur für die Seite, auf der die Lupe angetippt wurde – nach dem Navigieren (Suche abgeschickt,
  // Link angetippt) ist das Feld damit von selbst wieder eingeklappt
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const setOpen = (next: boolean) => setOpenAt(next ? pathname : null);
  const panel = usePresence(open);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpenAt(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={id}
        aria-label={open ? 'Suche schließen' : 'Suchen'}
        data-testid="mobile-search-toggle"
        title="Suchen"
        className={buttonClasses({ variant: 'ghost', size: 'sm', className: cn('w-10 px-0 md:hidden', open && 'bg-ink-900/5', className) })}
      >
        <Swap active={open} on={<X className="size-5" aria-hidden="true" />} off={<Search className="size-5" aria-hidden="true" />} />
      </button>
      {panel.present ? (
        <form
          id={id}
          action="/suche"
          role="search"
          data-state={panel.state}
          // Beim Ausblenden nicht mehr bedienbar (Fokus und Vorlesesoftware überspringen das Feld)
          inert={!open}
          className="drop absolute inset-x-0 top-full z-40 flex gap-2 border-b border-line bg-surface px-4 py-3 shadow-[var(--shadow-card)] md:hidden"
        >
          <label htmlFor={`${id}-q`} className="sr-only">
            Anzeigen durchsuchen
          </label>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-ink-400" aria-hidden="true" />
            <input
              ref={inputRef}
              id={`${id}-q`}
              name="q"
              type="search"
              placeholder="Was suchst du?"
              enterKeyHint="search"
              className="h-11 w-full rounded-xl border border-line-strong bg-canvas pr-3 pl-10 text-base placeholder:text-ink-400 focus:border-brand-500 focus:bg-surface focus:ring-3 focus:ring-brand-500/20 focus:outline-none"
            />
          </div>
          <button type="submit" className={buttonClasses({ className: 'h-11 shrink-0 px-4' })}>
            Suchen
          </button>
        </form>
      ) : null}
    </>
  );
}
