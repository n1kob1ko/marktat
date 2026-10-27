import { Sparkles } from 'lucide-react';
import { cn } from '@marktat/ui';
import { formatAmountCents, formatDate, lastIncludedDay, type IntroOffer } from '@marktat/shared';

/**
 * Einführungsaktion: ehrlich und ohne Rabatt-Optik – kein durchgestrichener Preis, keine künstliche Frist.
 * Ein Enddatum und der geplante Standardpreis erscheinen nur, wenn sie im Admin-Bereich so eingestellt sind.
 */
export function IntroBanner({ intro, className }: { intro: IntroOffer; className?: string }) {
  return (
    <section
      aria-label="Einführungsaktion"
      className={cn('flex flex-col gap-4 rounded-[var(--radius-card)] border border-brand-200 bg-brand-50 p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6', className)}
    >
      <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-start sm:gap-1">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide text-brand-700 uppercase">
          <Sparkles className="size-3.5" aria-hidden="true" /> Einführungsaktion
        </span>
        <span className="text-3xl font-bold text-brand-900 tabular-nums">{formatAmountCents(0)}</span>
      </div>
      <div className="min-w-0 space-y-1.5 text-sm leading-relaxed text-ink-700">
        <p className="text-base font-semibold text-ink-950">{intro.title}</p>
        <p>{intro.description}</p>
        {intro.endsAt ? <p>Kostenlos für neue Inserate bis zum {formatDate(lastIncludedDay(intro.endsAt))}.</p> : null}
        {intro.plannedPriceCents !== null ? (
          <p className="text-ink-600">Geplanter Standardpreis nach der Einführungsphase: {formatAmountCents(intro.plannedPriceCents)}.</p>
        ) : null}
        <p className="text-ink-500">Was du jetzt kostenlos veröffentlichst, bleibt für die gesamte Laufzeit kostenlos.</p>
      </div>
    </section>
  );
}
