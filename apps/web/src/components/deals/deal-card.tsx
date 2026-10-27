import Link from 'next/link';
import { Globe, ImageIcon, MapPin, Store } from 'lucide-react';
import { cn } from '@marktat/ui';
import { formatDate, type DealSummary } from '@marktat/shared';
import { dealValidity, endsSoon } from '@/lib/deals';
import { DealPrice, DiscountBadge } from './deal-price';

/**
 * Deal-Karte – bewusst anders als die Inseratskarte: Händler oben, Rabatt-Kennzeichen, Gültigkeit und
 * „Zuletzt geprüft“ statt Veröffentlichungsdatum, Kanal (online / im Geschäft) statt Standort allein.
 */
export function DealCard({ deal, className }: { deal: DealSummary; className?: string }) {
  const online = deal.channel !== 'LOCAL';
  const local = deal.channel !== 'ONLINE';
  return (
    <article
      className={cn(
        'group relative flex w-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)]',
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        {deal.merchant.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Logo kommt verarbeitet aus der API
          <img src={deal.merchant.logoUrl} alt="" width={24} height={24} className="size-6 shrink-0 rounded object-contain" loading="lazy" />
        ) : (
          <Store className="size-4.5 shrink-0 text-ink-400" aria-hidden="true" />
        )}
        <span className="truncate text-xs font-semibold text-ink-700">{deal.merchant.name}</span>
      </div>
      <div className="relative aspect-[4/3] bg-canvas">
        {deal.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Vorschaubild ist serverseitig optimiert (WebP 480 × 360)
          <img src={deal.imageUrl} alt="" width={480} height={360} className="size-full object-contain" loading="lazy" decoding="async" />
        ) : (
          <div className="flex size-full items-center justify-center">
            <ImageIcon className="size-8 text-ink-300" aria-hidden="true" />
          </div>
        )}
        <DiscountBadge percent={deal.discountPercent} className="absolute top-2.5 left-2.5" />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-2 font-sans text-[0.9375rem] leading-snug font-semibold tracking-normal text-ink-900">
          <Link href={`/deals/${deal.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
            {deal.title}
          </Link>
        </h3>
        <DealPrice deal={deal} />
        <ul className="mt-auto space-y-1 pt-1 text-xs text-ink-600">
          <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {online ? (
              <span className="inline-flex items-center gap-1">
                <Globe className="size-3.5" aria-hidden="true" /> Online
              </span>
            ) : null}
            {local ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {deal.nearestStore ? `${deal.nearestStore.postalCode} ${deal.nearestStore.place}` : 'Im Geschäft'}
                  {deal.nearestStore?.distanceKm != null ? ` · ${deal.nearestStore.distanceKm < 1 ? '< 1' : Math.round(deal.nearestStore.distanceKm)} km` : ''}
                  {deal.storeCount > 1 ? ` · ${deal.storeCount} Filialen` : ''}
                </span>
              </span>
            ) : null}
          </li>
          <li className={cn(endsSoon(deal) && 'font-semibold text-accent-700')}>{dealValidity(deal)}</li>
          {deal.lastVerifiedAt ? <li className="text-ink-500">Zuletzt geprüft am {formatDate(deal.lastVerifiedAt)}</li> : null}
        </ul>
        {deal.isAffiliateLink ? <p className="text-[0.6875rem] font-semibold tracking-wide text-ink-500 uppercase">Werbelink</p> : null}
      </div>
    </article>
  );
}
