'use client';

import { cn } from '@marktat/ui';

interface ChoiceChipsProps<T extends string> {
  /** Name des Formularfelds; ohne Namen wird nichts abgeschickt (z. B. wenn ein verstecktes Feld den Wert trägt) */
  name: string;
  legend: string;
  /** Überschrift nur für Screenreader (wenn sie daneben schon sichtbar ist) */
  legendHidden?: boolean;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  error?: string | string[];
  columns?: string;
}

/** Auswahl als Knöpfe statt Auswahlliste: alle Möglichkeiten auf einen Blick, ein Tipp genügt. */
export function ChoiceChips<T extends string>({
  name,
  legend,
  legendHidden,
  options,
  value,
  onChange,
  error,
  columns = 'grid-cols-2 sm:grid-cols-4',
}: ChoiceChipsProps<T>) {
  const errorText = Array.isArray(error) ? error[0] : error;
  const errorId = errorText ? `${name}-chips-error` : undefined;
  return (
    <fieldset role="radiogroup" aria-describedby={errorId} aria-invalid={errorText ? true : undefined} className="space-y-1.5">
      <legend className={cn(legendHidden ? 'sr-only' : 'mb-1.5 text-sm font-semibold text-ink-800')}>{legend}</legend>
      <div className={cn('grid gap-2', columns)}>
        {options.map((option) => (
          <label
            key={option.value || 'none'}
            className={cn(
              'flex min-h-11 cursor-pointer items-center justify-center rounded-xl border px-3 py-2 text-center text-sm font-semibold press has-focus-visible:ring-3 has-focus-visible:ring-brand-500/30',
              value === option.value ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-line-strong text-ink-700 hover:border-ink-400',
            )}
          >
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} className="sr-only" />
            {option.label}
          </label>
        ))}
      </div>
      {errorText ? (
        <p id={errorId} className="text-sm font-medium text-danger-600">
          {errorText}
        </p>
      ) : null}
    </fieldset>
  );
}
