'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bookmark,
  Briefcase,
  Car,
  CircleUserRound,
  CornerDownLeft,
  Heart,
  House,
  LayoutList,
  MessageCircle,
  Percent,
  Plus,
  Search,
  ShoppingBag,
  SunMoon,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@marktat/ui';
import { filterCommands, type Command } from '@/lib/commands';
import { MOTION } from '@/lib/motion';
import { Kbd } from './kbd';
import { toggleTheme } from './theme-toggle';

const ICONS: Record<string, LucideIcon> = {
  search: Search,
  inserieren: Plus,
  nachrichten: MessageCircle,
  merkliste: Heart,
  anzeigen: LayoutList,
  suchen: Bookmark,
  konto: CircleUserRound,
  marktplatz: ShoppingBag,
  'auto-motor': Car,
  immobilien: House,
  jobs: Briefcase,
  deals: Percent,
  dienstleistungen: Wrench,
  theme: SunMoon,
};

type Entry = Pick<Command, 'id' | 'label' | 'href' | 'action'> & { group: string };

/** Das Schnellmenü selbst (siehe command-menu.tsx). Natives <dialog>: Fokusfalle, Escape und Hintergrund kommen vom Browser. */
export function CommandDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const text = query.trim();
  const entries: Entry[] = [
    ...(text ? [{ id: 'search', label: `Nach „${text}“ suchen`, href: `/suche?q=${encodeURIComponent(text)}`, group: 'Suche' }] : []),
    ...filterCommands(text),
  ];
  const index = Math.min(active, entries.length - 1);

  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => {
      clearTimeout(timer.current);
      el?.close();
    };
  }, []);

  // Den gewählten Eintrag im Bild halten, wenn die Liste länger ist als das Fenster
  useEffect(() => {
    document.getElementById(`${listId}-${index}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [index, listId]);

  const close = () => dialog.current?.close();

  function run(entry: Entry | undefined) {
    if (!entry) return;
    if (entry.action === 'theme') toggleTheme();
    else if (entry.href) router.push(entry.href);
    close();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const last = entries.length - 1;
    if (event.key === 'ArrowDown') setActive(index >= last ? 0 : index + 1);
    else if (event.key === 'ArrowUp') setActive(index <= 0 ? last : index - 1);
    else if (event.key === 'Home') setActive(0);
    else if (event.key === 'End') setActive(last);
    else if (event.key === 'Enter' && !event.nativeEvent.isComposing) run(entries[index]);
    else return;
    event.preventDefault();
  }

  return (
    <dialog
      ref={dialog}
      aria-label="Schnellmenü"
      data-testid="command-menu"
      // Nur echtes Schließen zählt (StrictMode öffnet den Dialog im Entwicklungsmodus zweimal)
      onClose={() => {
        if (dialog.current?.open) return;
        clearTimeout(timer.current);
        timer.current = setTimeout(onClose, MOTION.modalExit);
      }}
      // Klick neben das Menü (auf den abgedunkelten Hintergrund) schließt
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className="modal mx-auto mt-[12vh] mb-auto w-[min(36rem,calc(100vw-2rem))] origin-top overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface p-0 text-ink-900 shadow-xl"
    >
      <div className="relative border-b border-line">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-400" aria-hidden="true" />
        <input
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={entries.length ? `${listId}-${index}` : undefined}
          aria-autocomplete="list"
          aria-label="Suchen oder springen zu"
          placeholder="Suchen oder springen zu …"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          maxLength={100}
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="h-14 w-full bg-transparent pr-16 pl-12 text-base placeholder:text-ink-400 focus:outline-none"
        />
        <Kbd className="absolute top-1/2 right-4 -translate-y-1/2">Esc</Kbd>
      </div>

      <ul id={listId} role="listbox" aria-label="Vorschläge" className="max-h-[min(24rem,55vh)] overflow-y-auto overscroll-contain p-2">
        {entries.map((entry, i) => {
          const Icon = ICONS[entry.id] ?? Search;
          const selected = i === index;
          const heading = i === 0 || entries[i - 1]!.group !== entry.group ? entry.group : null;
          return (
            <li key={entry.id} role="presentation">
              {heading ? <p className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-ink-500 uppercase">{heading}</p> : null}
              <div
                id={`${listId}-${i}`}
                role="option"
                aria-selected={selected}
                onPointerMove={() => setActive(i)}
                onClick={() => run(entry)}
                className={cn('flex h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-[0.9375rem]', selected ? 'bg-brand-50 font-semibold text-brand-900' : 'text-ink-800')}
              >
                <Icon className={cn('size-[1.125rem] shrink-0', selected ? 'text-brand-700' : 'text-ink-400')} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {selected ? <CornerDownLeft className="size-4 shrink-0 text-brand-700" aria-hidden="true" /> : null}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="hidden items-center gap-4 border-t border-line bg-canvas px-4 py-2.5 text-xs text-ink-500 [@media(hover:hover)]:flex">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> wählen
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd> öffnen
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Esc</Kbd> schließen
        </span>
      </p>
    </dialog>
  );
}
