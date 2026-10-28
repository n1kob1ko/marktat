import { cn } from '@marktat/ui';
import { REFERENCE_PRICE_SHORT, formatPriceCents, type DealSummary } from '@marktat/shared';

/**
 * Angebotspreis; Vergleichspreis und Rabatt nur, wenn die API eine zulässige Grundlage liefert
 * (UVP mit Quelle oder niedrigster Preis der letzten 30 Tage). Die Grundlage steht immer dabei.
 */
export function DealPrice({
  deal,
  size = 'md',
  className,
}: {
  deal: Pick<DealSummary, 'priceCents' | 'referencePriceCents' | 'referencePriceType' | 'discountPercent' | 'unitPriceText'>;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const hasReference = deal.discountPercent !== null && deal.referencePriceCents !== null && deal.referencePriceType !== null;
  return (
    <div className={cn('space-y-0.5', className)}>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className={cn('font-display font-bold text-ink-950', size === 'lg' ? 'text-3xl sm:text-4xl' : 'text-lg')}>{formatPriceCents(deal.priceCents)}</span>
        {hasReference ? (
          <span className={cn('text-ink-500', size === 'lg' ? 'text-base' : 'text-xs')}>
            <span className="sr-only">statt </span>
            <s>{formatPriceCents(deal.referencePriceCents!)}</s> {REFERENCE_PRICE_SHORT[deal.referencePriceType!]}
          </span>
        ) : null}
      </p>
      {deal.unitPriceText ? <p className="text-xs text-ink-500">{deal.unitPriceText}</p> : null}
    </div>
  );
}

/** Rabatt-Kennzeichen (nur mit Grundlage) */
export function DiscountBadge({ percent, className }: { percent: number | null; className?: string }) {
  if (percent === null) return null;
  return (
    <span className={cn('inline-flex items-center rounded-lg bg-accent-500 px-2 py-0.5 text-sm font-bold text-ink-950 tabular-nums shadow-sm', className)}>
      −{percent} %
    </span>
  );
}
