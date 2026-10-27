import Link from 'next/link';
import { ImageIcon, MapPin } from 'lucide-react';
import { Badge } from '@marktat/ui';
import type { ListingSummary } from '@marktat/shared';
import { PriceTag } from './price-tag';
import { RelativeDate } from './relative-date';

export function ListingCard({ listing }: { listing: ListingSummary }) {
  return (
    <article className="group relative flex w-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)]">
      <div className="relative aspect-[4/3] bg-canvas">
        {listing.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Vorschaubild ist serverseitig optimiert (WebP 480 × 360)
          <img src={listing.imageUrl} alt="" width={480} height={360} className="size-full object-cover" loading="lazy" decoding="async" />
        ) : (
          <div className="flex size-full items-center justify-center bg-[repeating-linear-gradient(135deg,transparent,transparent_12px,rgb(18_23_21/0.025)_12px,rgb(18_23_21/0.025)_24px)]">
            <ImageIcon className="size-8 text-ink-300" aria-hidden="true" />
          </div>
        )}
        {listing.isBusiness ? (
          <Badge tone="brand" className="absolute top-3 left-3 shadow-sm">
            Händler
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
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
                <span className="shrink-0 whitespace-nowrap text-ink-400">
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
