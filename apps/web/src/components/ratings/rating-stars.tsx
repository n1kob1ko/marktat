import Link from 'next/link';
import { Star } from 'lucide-react';
import { cn } from '@marktat/ui';
import type { RatingSummary } from '@marktat/shared';

const SIZES = { sm: 'size-4', md: 'size-5', lg: 'size-7' } as const;

export function formatAverage(value: number) {
  return value.toLocaleString('de-AT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Fünf Sterne, anteilig gefüllt (z. B. 4,5). Für Screenreader als „4,5 von 5 Sternen“. */
export function Stars({
  value,
  size = 'sm',
  className,
}: {
  value: number;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const percent = Math.max(0, Math.min(100, (value / 5) * 100));
  const row = (filled: boolean) =>
    Array.from({ length: 5 }, (_, i) => (
      <Star
        key={i}
        className={cn(
          SIZES[size],
          'shrink-0',
          filled ? 'fill-accent-500 text-accent-500' : 'fill-line text-line-strong',
        )}
        aria-hidden="true"
        strokeWidth={1.5}
      />
    ));
  return (
    <span
      role="img"
      aria-label={`${formatAverage(value)} von 5 Sternen`}
      className={cn('relative inline-flex', className)}
    >
      <span className="inline-flex">{row(false)}</span>
      <span
        className="absolute inset-y-0 left-0 inline-flex overflow-hidden"
        style={{ width: `${percent}%` }}
      >
        {row(true)}
      </span>
    </span>
  );
}

/** Kurzfassung für Verkäufer-Karten: Sterne, Durchschnitt und Anzahl, verlinkt auf alle Bewertungen */
export function RatingSummaryLink({
  summary,
  href,
  className,
}: {
  summary: RatingSummary;
  href: string;
  className?: string;
}) {
  if (!summary.count || summary.average === null) {
    return <p className={cn('text-sm text-ink-500', className)}>Noch keine Bewertungen</p>;
  }
  return (
    <Link
      href={href}
      className={cn('inline-flex items-center gap-2 rounded-lg text-sm hover:underline', className)}
    >
      <Stars value={summary.average} />
      <span className="font-semibold text-ink-900">{formatAverage(summary.average)}</span>
      <span className="text-ink-500">
        ({summary.count} {summary.count === 1 ? 'Bewertung' : 'Bewertungen'})
      </span>
    </Link>
  );
}

/** Verteilung der Sterne als Balken (5 oben) */
export function RatingDistribution({ summary }: { summary: RatingSummary }) {
  return (
    <ul className="space-y-1.5" aria-label="Verteilung der Bewertungen">
      {[5, 4, 3, 2, 1].map((stars) => {
        const count = summary.distribution[stars - 1] ?? 0;
        const share = summary.count ? Math.round((count / summary.count) * 100) : 0;
        return (
          <li key={stars} className="flex items-center gap-2 text-sm">
            <span className="w-14 shrink-0 text-ink-600">
              {stars} {stars === 1 ? 'Stern' : 'Sterne'}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
              <span
                className="block h-full rounded-full bg-accent-500"
                style={{ width: `${share}%` }}
              />
            </span>
            <span className="w-8 shrink-0 text-right text-ink-500 tabular-nums">{count}</span>
          </li>
        );
      })}
    </ul>
  );
}
