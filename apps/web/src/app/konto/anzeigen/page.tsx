import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { MapPin, Pencil, Plus } from 'lucide-react';
import { buttonClasses, Card, Skeleton } from '@marktat/ui';
import { formatDate, type ListingSummary } from '@marktat/shared';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { FlashMessage } from '@/components/flash-message';
import { ListingStatusBadge } from '@/components/listing-status-badge';
import { PriceTag } from '@/components/price-tag';
import { ConfirmDeleteButton } from '@/components/confirm-delete-button';
import { listingStatusAction } from './actions';

export const metadata: Metadata = { title: 'Meine Anzeigen', robots: { index: false } };

export default function MyListingsPage({ searchParams }: PageProps<'/konto/anzeigen'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <MyListings searchParams={searchParams} />
    </Suspense>
  );
}

async function MyListings({ searchParams }: Pick<PageProps<'/konto/anzeigen'>, 'searchParams'>) {
  const [{ token }, params] = await Promise.all([requireUser('/konto/anzeigen'), searchParams]);
  const listings = await api<ListingSummary[]>('/listings/mine', { token, cache: 'no-store' });
  const hinweis = typeof params.hinweis === 'string' ? params.hinweis : undefined;
  const fehler = typeof params.fehler === 'string' ? params.fehler : undefined;

  return (
    <div className="space-y-4">
      <FlashMessage hinweis={hinweis} fehler={fehler} />
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-ink-600">{listings.length} {listings.length === 1 ? 'Anzeige' : 'Anzeigen'}</p>
        <Link href="/inserieren" className={buttonClasses({ size: 'sm' })}>
          <Plus className="size-4" aria-hidden="true" /> Neue Anzeige
        </Link>
      </div>
      {listings.length === 0 ? (
        <Card className="px-6 py-12 text-center">
          <p className="font-semibold text-ink-900">Du hast noch keine Anzeigen.</p>
          <p className="mt-1 text-sm text-ink-500">Was liegt bei dir herum, das jemand anderer brauchen kann?</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {listings.map((listing) => (
            <li key={listing.id}>
              <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <ListingStatusBadge status={listing.status} />
                    <span className="text-xs text-ink-500">
                      {listing.publishedAt ? `Online seit ${formatDate(listing.publishedAt)}` : `Erstellt am ${formatDate(listing.createdAt)}`}
                    </span>
                  </div>
                  <Link href={`/anzeige/${listing.id}`} className="block truncate font-semibold text-ink-900 hover:text-brand-700 hover:underline">
                    {listing.title}
                  </Link>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-500">
                    <PriceTag
                      priceType={listing.priceType}
                      priceCents={listing.priceCents}
                      suffix={listing.priceSuffix}
                      salary={listing.vertical === 'JOBS' ? listing.salary : undefined}
                      className="text-base"
                    />
                    {listing.location ? (
                      <span className="flex items-center gap-1"><MapPin className="size-3.5" aria-hidden="true" /> {listing.location.postalCode} {listing.location.place}</span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Link href={`/anzeige/${listing.id}/bearbeiten`} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
                    <Pencil className="size-4" aria-hidden="true" /> Bearbeiten
                  </Link>
                  <form action={listingStatusAction} className="flex gap-2">
                    <input type="hidden" name="id" value={listing.id} />
                    {listing.status === 'ACTIVE' ? (
                      <button name="action" value="pause" className={buttonClasses({ variant: 'outline', size: 'sm' })}>Pausieren</button>
                    ) : null}
                    {listing.status === 'PAUSED' ? (
                      <button name="action" value="resume" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>Fortsetzen</button>
                    ) : null}
                    {listing.status === 'DRAFT' || listing.status === 'EXPIRED' ? (
                      <button name="action" value="publish" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                        {listing.status === 'DRAFT' ? 'Veröffentlichen' : 'Verlängern'}
                      </button>
                    ) : null}
                    <ConfirmDeleteButton />
                  </form>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
