import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Skeleton } from '@marktat/ui';
import type { ListingDetail, RelatedListings as Related } from '@marktat/shared';
import { api } from '@/lib/api';
import { ListingCard } from '@/components/listing-card';

const GRID = 'grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4';

/** Unter der Anzeige: ähnliche Anzeigen in der Nähe und weitere vom selben Anbieter (nur bei öffentlichen Anzeigen). */
export async function RelatedListings({ listing }: { listing: ListingDetail }) {
  const related = await api<Related>(`/listings/${listing.id}/related`, {
    cache: 'no-store',
  }).catch(() => null);
  if (!related || (!related.similar.length && !related.fromSeller.length)) return null;
  const { seller } = listing;
  const sellerName = seller.companyName ?? seller.displayName;
  return (
    <div className="space-y-10 pt-4">
      {related.fromSeller.length ? (
        <section aria-labelledby="vom-anbieter" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 id="vom-anbieter" className="text-xl font-bold text-ink-950 sm:text-2xl">
              Mehr von {sellerName}
            </h2>
            {seller.accountType === 'BUSINESS' ? (
              <Link
                href={`/haendler/${seller.id}`}
                className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline"
              >
                Alle {related.sellerTotal + 1} Anzeigen{' '}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            ) : related.sellerTotal > related.fromSeller.length ? (
              <p className="text-sm text-ink-500">
                und {related.sellerTotal - related.fromSeller.length} weitere
              </p>
            ) : null}
          </div>
          <ul className={GRID}>
            {related.fromSeller.map((item) => (
              <li key={item.id} className="flex">
                <ListingCard listing={item} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {related.similar.length ? (
        <section aria-labelledby="aehnliche" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 id="aehnliche" className="text-xl font-bold text-ink-950 sm:text-2xl">
              {listing.location ? 'Ähnliche Anzeigen in der Nähe' : 'Ähnliche Anzeigen'}
            </h2>
            <Link
              href={`/suche?kategorie=${listing.category.path}`}
              className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline"
            >
              Alle in {listing.category.name} <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
          <ul className={GRID}>
            {related.similar.map((item, index) => (
              // Am Handy und Tablet reichen zwei Reihen
              <li key={item.id} className={index < 4 ? 'flex' : 'hidden lg:flex'}>
                <ListingCard listing={item} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function RelatedListingsSkeleton() {
  return (
    <div className="space-y-4 pt-4">
      <Skeleton className="h-8 w-64" />
      <div className={GRID}>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="aspect-[3/4]" />
        ))}
      </div>
    </div>
  );
}
