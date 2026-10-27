import Link from 'next/link';
import { ImageIcon, MapPin } from 'lucide-react';
import { Badge, cn } from '@marktat/ui';
import type { ListingSummary } from '@marktat/shared';
import { FavoriteButton } from './favorites/favorite-button';
import { PriceTag } from './price-tag';
import { RelativeDate } from './relative-date';

/** `favorite`: bekannter Merkstatus (sonst wird er nachgeladen), `false` bei `showFavorite={false}` blendet das Herz aus. */
export function ListingCard({ listing, favorite, showFavorite = true }: { listing: ListingSummary; favorite?: boolean; showFavorite?: boolean }) {
  return (
    <article
      className={cn(
        'group relative flex w-full flex-col overflow-hidden rounded-[var(--radius-card)] border bg-surface shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)]',
        // Hervorhebung: dezent – farbiger Rahmen und leicht getönter Textbereich, Inhalt bleibt unverändert
        listing.highlighted ? 'border-accent-300 ring-1 ring-accent-300' : 'border-line',
      )}
    >
      <div className="relative aspect-[4/3] bg-canvas">
        {listing.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Vorschaubild ist serverseitig optimiert (WebP 480 × 360)
          <img src={listing.imageUrl} alt="" width={480} height={360} className="size-full object-cover" loading="lazy" decoding="async" />
        ) : (
          <div className="flex size-full items-center justify-center bg-[repeating-linear-gradient(135deg,transparent,transparent_12px,rgb(18_23_21/0.025)_12px,rgb(18_23_21/0.025)_24px)]">
            <ImageIcon className="size-8 text-ink-300" aria-hidden="true" />
          </div>
        )}
        <PromotionBadges listing={listing} className="absolute top-3 left-3" />
        {showFavorite ? <FavoriteButton listingId={listing.id} title={listing.title} initial={favorite} className="absolute top-2.5 right-2.5" /> : null}
      </div>
      <div className={cn('flex flex-1 flex-col gap-2 p-4', listing.highlighted && 'bg-accent-50/50')}>
        <h3 className="line-clamp-2 font-sans text-[0.9375rem] leading-snug font-semibold tracking-normal text-ink-900">
          <Link href={`/anzeige/${listing.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
            {listing.title}
          </Link>
        </h3>
        {listing.facts.length ? <p className="line-clamp-1 text-xs text-ink-600">{listing.facts.join(' · ')}</p> : null}
        <PriceTag
          priceType={listing.priceType}
          priceCents={listing.priceCents}
          suffix={listing.priceSuffix}
          salary={listing.vertical === 'JOBS' ? listing.salary : undefined}
          className="text-lg"
        />
        <div className="mt-auto flex flex-col gap-1 pt-1 text-xs text-ink-500 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
          {listing.location ? (
            <span className="flex min-w-0 items-center gap-1">
              <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {listing.location.postalCode} {listing.location.place}
              </span>
              {typeof listing.distanceKm === 'number' ? (
                <span className="shrink-0 whitespace-nowrap text-ink-500">
                  · {listing.distanceKm < 1 ? '< 1' : Math.round(listing.distanceKm).toLocaleString('de-AT')} km
                </span>
              ) : null}
            </span>
          ) : (
            <span />
          )}
          {listing.publishedAt ? (
            <span className="whitespace-nowrap">
              <RelativeDate value={listing.publishedAt} />
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/**
 * Kennzeichnung: „Top“ und „Hervorgehoben“ sind während der Einführungsphase kostenlose Zusatzleistungen –
 * nur tatsächlich bezahlte Platzierungen tragen „Gesponsert“.
 */
export function PromotionBadges({ listing, className }: { listing: Pick<ListingSummary, 'isBusiness' | 'highlighted' | 'top' | 'sponsored'>; className?: string }) {
  if (!listing.isBusiness && !listing.highlighted && !listing.top) return null;
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {listing.top ? (
        <Badge tone="accent" className="bg-accent-500 text-ink-950 shadow-sm">
          Top
        </Badge>
      ) : null}
      {listing.highlighted && !listing.top ? (
        <Badge tone="accent" className="shadow-sm">
          Hervorgehoben
        </Badge>
      ) : null}
      {listing.isBusiness ? (
        <Badge tone="brand" className="shadow-sm">
          Händler
        </Badge>
      ) : null}
      {listing.sponsored ? (
        <Badge tone="neutral" className="bg-surface/90 shadow-sm" title="Bezahlte Platzierung">
          Gesponsert
        </Badge>
      ) : null}
    </div>
  );
}
