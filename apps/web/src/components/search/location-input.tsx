'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, MapPin, X } from 'lucide-react';
import { cn } from '@marktat/ui';
import { isAustrianPostalCode, type LocationSummary } from '@marktat/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export const locationLabel = (l: LocationSummary) => `${l.postalCode} ${l.place}`;

/**
 * Ortsauswahl mit Vorschlägen (PLZ oder Ortsname). Übermittelt `ort` (gewählter Ort) bzw. `plz`
 * (nur eine PLZ eingegeben). Tastatur: Pfeiltasten, Enter, Escape (ARIA-Combobox).
 */
export function LocationInput({
  initial,
  initialPostalCode,
  onChange,
}: {
  initial: LocationSummary | null;
  initialPostalCode?: string;
  /** Wird bei jeder Auswahl/Änderung aufgerufen; `true` = ein Ort ist gesetzt */
  onChange?: (hasLocation: boolean, committed: boolean) => void;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState(initial ? locationLabel(initial) : (initialPostalCode ?? ''));
  const [selected, setSelected] = useState<LocationSummary | null>(initial);
  const [options, setOptions] = useState<LocationSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);

  const query = text.trim();
  const shouldSearch = !selected && query.length >= 2;

  useEffect(() => {
    if (!shouldSearch) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setStatus('loading');
      fetch(`${API_URL}/v1/geo/locations?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((rows: LocationSummary[]) => {
          setOptions(rows.slice(0, 8));
          setActive(rows.length ? 0 : -1);
          setStatus('idle');
        })
        .catch((error: unknown) => {
          if ((error as Error).name !== 'AbortError') setStatus('error');
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, shouldSearch]);

  const choose = (location: LocationSummary) => {
    setSelected(location);
    setText(locationLabel(location));
    setOpen(false);
    onChange?.(true, true);
  };

  const clear = () => {
    setSelected(null);
    setText('');
    setOptions([]);
    onChange?.(false, true);
    inputRef.current?.focus();
  };

  const postalCode = !selected && isAustrianPostalCode(query) ? query : '';
  const showList = open && shouldSearch && (options.length > 0 || status !== 'loading');

  return (
    <div className="relative">
      <input type="hidden" name="ort" value={selected ? String(selected.id) : ''} />
      <input type="hidden" name="plz" value={postalCode} />
      <MapPin className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
      <input
        ref={inputRef}
        id="f-ort"
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        inputMode="search"
        placeholder="PLZ oder Ort, z. B. 1010 oder Graz"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSelected(null);
          setOpen(true);
          onChange?.(isAustrianPostalCode(e.target.value.trim()), false);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          // Nur PLZ eingegeben und nicht ausgewählt: gilt trotzdem als Ort
          if (!selected) onChange?.(isAustrianPostalCode(query), true);
        }}
        onKeyDown={(e) => {
          if (!showList || !options.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => (i + 1) % options.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => (i - 1 + options.length) % options.length);
          } else if (e.key === 'Enter' && active >= 0) {
            e.preventDefault();
            choose(options[active]!);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="block h-11 w-full rounded-xl border border-line-strong bg-surface pr-9 pl-9 text-[0.9375rem] text-ink-900 placeholder:text-ink-400 hover:border-ink-400 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/20 focus:outline-none"
      />
      {status === 'loading' && shouldSearch ? (
        <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-ink-400" aria-hidden="true" />
      ) : text ? (
        <button
          type="button"
          onClick={clear}
          className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-ink-400 hover:bg-canvas hover:text-ink-700"
          aria-label="Ort entfernen"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      ) : null}
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Vorschläge"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-xl border border-line bg-surface py-1 shadow-[var(--shadow-card-hover)]"
        >
          {status === 'error' ? (
            <li className="px-3.5 py-2.5 text-sm text-ink-500">Orte konnten nicht geladen werden.</li>
          ) : options.length === 0 ? (
            <li className="px-3.5 py-2.5 text-sm text-ink-500">Kein Ort gefunden. Prüfe die PLZ oder Schreibweise.</li>
          ) : (
            options.map((option, index) => (
              <li
                key={option.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                // mousedown statt click: sonst schließt das Blur-Ereignis die Liste vorher
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(option);
                }}
                onMouseEnter={() => setActive(index)}
                className={cn('cursor-pointer px-3.5 py-2 text-sm', index === active ? 'bg-brand-50 text-brand-900' : 'text-ink-800')}
              >
                <span className="font-semibold">{option.postalCode}</span> {option.place}
                {option.municipality ? <span className="text-ink-500"> ({option.municipality})</span> : null}
                <span className="block text-xs text-ink-500">
                  {option.district}, {option.state}
                </span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
