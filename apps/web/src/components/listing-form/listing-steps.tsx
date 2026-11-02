import { Check } from 'lucide-react';
import { cn } from '@marktat/ui';

/** Schritte beim Inserieren: Angaben → Preis & Ort → Fotos (nach dem Speichern auf der Bilder-Seite) */
export function listingStepLabels(locationLabel = 'Ort', hasPrice = true) {
  return ['Was bietest du an?', hasPrice ? `Preis & ${locationLabel}` : locationLabel, 'Fotos'] as const;
}

export function ListingSteps({ current, labels = listingStepLabels() }: { current: 1 | 2 | 3; labels?: readonly string[] }) {
  return (
    <nav aria-label="Schritte beim Inserieren">
      <p className="mb-2 text-sm font-semibold text-ink-700">
        Schritt {current} von {labels.length}: <span className="text-ink-950">{labels[current - 1]}</span>
      </p>
      <ol className="grid grid-cols-3 gap-2">
        {labels.map((label, index) => {
          const step = index + 1;
          const done = step < current;
          const active = step === current;
          return (
            <li key={label} aria-current={active ? 'step' : undefined} className="min-w-0">
              <span className={cn('block h-1.5 rounded-full', done || active ? 'bg-brand-600' : 'bg-line-strong')} aria-hidden="true" />
              <span className={cn('mt-1.5 flex items-center gap-1 truncate text-xs', active ? 'font-semibold text-ink-900' : 'text-ink-500')}>
                {done ? <Check className="size-3.5 shrink-0 text-brand-700" aria-hidden="true" /> : null}
                <span className="truncate">
                  {label}
                  {done ? <span className="sr-only"> (erledigt)</span> : null}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
