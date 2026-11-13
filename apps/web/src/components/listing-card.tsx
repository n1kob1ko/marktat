import { ImageIcon, MapPin } from 'lucide-react';
import { Badge, cn } from '@marktat/ui';
import type { ListingSummary } from '@marktat/shared';
import { FavoriteButton } from './favorites/favorite-button';
import { CardPhoto, ListingCardLink } from './listing-card-link';
import { PriceTag } from './price-tag';
import { RelativeDate } from './relative-date';
import { NewBadge } from './new-badge';

/** `favorite`: bekannter Merkstatus (sonst wird er nachgeladen), `false` bei `showFavorite={false}` blendet das Herz aus. */
export function ListingCard({ listing, favorite, showFavorite = true }: { listing: ListingSummary; favorite?: boolean; showFavorite?: boolean }) {
  // Jobs zeigen ein Gehalt (oft lang) im Textbereich, alle anderen den Preis gut sichtbar auf dem Foto
  const isJob = listing.vertical === 'JOBS';
  return (
    <article
      className={cn(
        'group relative flex w-full flex-col overflow-hidden rounded-[var(--radius-card)] border bg-surface shadow-[var(--shadow-card)] press-soft hover:shadow-[var(--shadow-card-hover)]',
        // Hervorhebung: dezent – farbiger Rahmen und leicht getönter Textbereich, Inhalt bleibt unverändert
        listing.highlighted ? 'border-accent-300 ring-1 ring-accent-300' : 'border-line',
      )}
    >
      <div className="relative aspect-[4/3] bg-canvas">
        {listing.imageUrl ? (
          <CardPhoto src={listing.imageUrl} placeholder={listing.imagePlaceholder} />
        ) : (
          <div className="flex size-full items-center justify-center bg-[repeating-linear-gradient(135deg,transparent,transparent_12px,rgb(18_23_21/0.025)_12px,rgb(18_23_21/0.025)_24px)]">
            <ImageIcon className="size-8 text-ink-300" aria-hidden="true" />
          </div>
        )}
        <div className="absolute top-3 left-3 flex max-w-[calc(100%-4rem)] flex-wrap gap-1.5">
          <AvailabilityBadge listing={listing} />
          {listing.publishedAt && listing.status === 'ACTIVE' ? <NewBadge publishedAt={listing.publishedAt} /> : null}
          <PromotionBadges listing={listing} />
        </div>
        {!isJob ? (
          <PriceTag
            priceType={listing.priceType}
            priceCents={listing.priceCents}
            suffix={listing.priceSuffix}
            className="absolute bottom-2.5 left-2.5 max-w-[calc(100%-1.25rem)] gap-x-1.5 rounded-lg bg-surface/95 px-2 py-0.5 text-base text-ink-950 shadow-[0_1px_3px_rgb(18_23_21/0.18)]"
          />
        ) : null}
        {showFavorite ? <FavoriteButton listingId={listing.id} title={listing.title} initial={favorite} className="absolute top-2.5 right-2.5" /> : null}
      </div>
      <div className={cn('flex flex-1 flex-col gap-1.5 p-3.5 sm:p-4', listing.highlighted && 'bg-accent-50/50')}>
        <h3 className="line-clamp-2 font-sans text-[0.9375rem] leading-snug font-semibold tracking-normal text-ink-900">
          <ListingCardLink href={`/anzeige/${listing.id}`}>{listing.title}</ListingCardLink>
        </h3>
        {listing.facts.length ? <p className="line-clamp-1 text-xs text-ink-600">{listing.facts.join(' · ')}</p> : null}
        {isJob ? <PriceTag priceType={listing.priceType} priceCents={listing.priceCents} salary={listing.salary} className="text-base" /> : null}
        <div className="mt-auto flex flex-col gap-0.5 pt-1.5 text-xs text-ink-500 tabular-nums sm:flex-row sm:items-center sm:justify-between sm:gap-2">
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
            <span className="shrink-0 whitespace-nowrap">
              <RelativeDate value={listing.publishedAt} />
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/** „Verkauft“ bzw. „Reserviert“ – vom Anbieter gesetzt; reservierte Anzeigen bleiben anfragbar */
export function AvailabilityBadge({ listing, className }: { listing: Pick<ListingSummary, 'status' | 'reserved'>; className?: string }) {
  if (listing.status === 'SOLD') {
    return (
      <Badge tone="neutral" className={cn('bg-ink-900 text-white shadow-sm', className)}>
        Verkauft
      </Badge>
    );
  }
  if (listing.reserved) {
    return (
      <Badge tone="warning" className={cn('shadow-sm', className)} title="Vom Anbieter reserviert – Anfragen sind weiterhin möglich">
        Reserviert
      </Badge>
    );
  }
  return null;
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
        <Badge tone="accent" className="bg-accent-500 text-on-accent shadow-sm">
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
