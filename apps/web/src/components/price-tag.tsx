import { cn } from '@marktat/ui';
import { formatPriceCents, type PriceType } from '@marktat/shared';

export function priceLabel(priceType: PriceType | null, priceCents: number | null): string {
  switch (priceType) {
    case 'FREE':
      return 'Zu verschenken';
    case 'ON_REQUEST':
      return 'Preis auf Anfrage';
    case 'FIXED':
    case 'NEGOTIABLE':
      return priceCents === null ? 'Preis auf Anfrage' : formatPriceCents(priceCents);
    default:
      return 'Kein Preis angegeben';
  }
}

export function PriceTag({
  priceType,
  priceCents,
  className,
}: {
  priceType: PriceType | null;
  priceCents: number | null;
  className?: string;
}) {
  return (
    <p className={cn('flex items-baseline gap-2 font-display font-bold text-brand-800', className)}>
      <span>{priceLabel(priceType, priceCents)}</span>
      {priceType === 'NEGOTIABLE' ? <span className="font-sans text-xs font-semibold text-ink-500">VB</span> : null}
    </p>
  );
}
