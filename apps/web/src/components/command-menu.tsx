'use client';

import dynamic from 'next/dynamic';
import { useEffect, useSyncExternalStore } from 'react';
import { Kbd, useModKey } from './kbd';

const CommandDialog = dynamic(() => import('./command-dialog').then((module) => module.CommandDialog), { ssr: false });

let open = false;
const listeners = new Set<() => void>();

function setOpen(next: boolean) {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openCommandMenu() {
  setOpen(true);
}

/**
 * Schnellmenü (Strg+K bzw. ⌘K): suchen und zu den wichtigsten Seiten springen, ohne die Hand von der Tastatur zu nehmen.
 * Hier steht nur der Tastatur-Horcher; das Menü selbst wird erst beim ersten Öffnen geladen.
 */
export function CommandMenu() {
  const isOpen = useSyncExternalStore(subscribe, () => open, () => false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      setOpen(!open);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return isOpen ? <CommandDialog onClose={() => setOpen(false)} /> : null;
}

/**
 * Hinweis auf das Kürzel im Suchfeld des Kopfs; ein Klick öffnet das Schnellmenü.
 * Erscheint nur, wo es eine Tastatur gibt (Zeiger mit Hover), und erst im Browser (Strg oder ⌘ je nach Gerät).
 */
export function SearchShortcutHint() {
  const mod = useModKey();
  if (!mod) return null;
  return (
    <button
      type="button"
      onClick={openCommandMenu}
      title="Schnellmenü öffnen"
      aria-keyshortcuts={mod === '⌘' ? 'Meta+K' : 'Control+K'}
      data-testid="search-shortcut"
      className="press absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded-md peer-[:not(:placeholder-shown)]:hidden [@media(hover:hover)]:block"
    >
      {/* Der Name entsteht aus dem Inhalt: sichtbarer Text („Strg K“) und Name passen so immer zusammen */}
      <span className="sr-only">Schnellmenü öffnen: </span>
      <Kbd className="hover:border-ink-400 hover:text-ink-700">{`${mod} K`}</Kbd>
    </button>
  );
}
