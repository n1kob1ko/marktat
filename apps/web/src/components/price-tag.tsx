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
  suffix,
  salary,
  className,
}: {
  priceType: PriceType | null;
  priceCents: number | null;
  /** z. B. „pro Monat“ bei Miete */
  suffix?: string | null;
  /** Jobs: Gehaltsangabe statt Preis; `null` = kein Gehalt angegeben */
  salary?: string | null;
  className?: string;
}) {
  if (salary !== undefined) {
    return (
      <p className={cn('font-display font-bold text-brand-800', className)}>
        <span className="sr-only">Gehalt: </span>
        {salary ?? 'Gehalt nach Vereinbarung'}
      </p>
    );
  }
  const hasAmount = (priceType === 'FIXED' || priceType === 'NEGOTIABLE') && priceCents !== null;
  return (
    <p className={cn('flex flex-wrap items-baseline gap-x-2 font-display font-bold text-brand-800', className)}>
      <span>{priceLabel(priceType, priceCents)}</span>
      {hasAmount && suffix ? <span className="font-sans text-sm font-semibold text-ink-600">{suffix}</span> : null}
      {priceType === 'NEGOTIABLE' ? <span className="font-sans text-xs font-semibold text-ink-500">VB</span> : null}
    </p>
  );
}
