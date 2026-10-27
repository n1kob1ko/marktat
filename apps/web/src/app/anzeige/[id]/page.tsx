import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { BadgeCheck, CalendarDays, Flag, Images, MapPin, MessageCircle, Pencil, Store, UserRound } from 'lucide-react';
import { Badge, Button, buttonClasses, Card, Container, Skeleton } from '@marktat/ui';
import { ATTRIBUTE_FIELDS, formatDate, ITEM_CONDITION_LABELS, type ListingDetail } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { PriceTag } from '@/components/price-tag';
import { ListingStatusBadge } from '@/components/listing-status-badge';
import { FlashMessage } from '@/components/flash-message';
import { listingStatusAction } from '@/app/konto/anzeigen/actions';
import { ListingGallery } from '@/components/listing-gallery';

export async function generateMetadata({ params }: PageProps<'/anzeige/[id]'>): Promise<Metadata> {
  const { id } = await params;
  const listing = await api<ListingDetail>(`/listings/${id}`, { cache: 'no-store' }).catch(() => null);
  if (!listing) return { title: 'Anzeige nicht gefunden', robots: { index: false } };
  return {
    title: listing.title,
    description: listing.description.slice(0, 155),
    alternates: { canonical: `/anzeige/${listing.id}` },
  };
}

export default function ListingPage({ params, searchParams }: PageProps<'/anzeige/[id]'>) {
  return (
    <Container className="py-8 sm:py-10">
      <Suspense fallback={<DetailSkeleton />}>
        <ListingContent params={params} searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

async function ListingContent({
  params,
  searchParams,
}: Pick<PageProps<'/anzeige/[id]'>, 'params' | 'searchParams'>) {
  const [{ id }, query, token] = await Promise.all([params, searchParams, getAccessToken()]);
  let listing: ListingDetail;
  try {
    listing = await api<ListingDetail>(`/listings/${id}`, { token: token ?? undefined, cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const { seller } = listing;
  const hinweis = typeof query.hinweis === 'string' ? query.hinweis : undefined;
  const fehler = typeof query.fehler === 'string' ? query.fehler : undefined;

  return (
    <div className="space-y-6">
      <FlashMessage hinweis={hinweis} fehler={fehler} />
      {listing.isOwner ? <OwnerBar listing={listing} /> : null}

      <nav aria-label="Brotkrümel" className="text-sm text-ink-500">
        <Link href="/" className="hover:text-brand-700 hover:underline">Startseite</Link>
        <span aria-hidden="true"> / </span>
        <Link href={`/suche?kategorie=${listing.category.id}`} className="hover:text-brand-700 hover:underline">
          {listing.category.name}
        </Link>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <ListingGallery images={listing.images} title={listing.title} />

          <Card className="p-5 sm:p-7">
            <div className="flex flex-wrap items-center gap-2">
              {listing.isBusiness ? <Badge tone="brand">Gewerblicher Anbieter</Badge> : <Badge>Privat</Badge>}
              {listing.condition ? <Badge tone="neutral">Zustand: {ITEM_CONDITION_LABELS[listing.condition]}</Badge> : null}
            </div>
            <h1 className="mt-3 text-2xl leading-tight font-bold text-ink-950 sm:text-3xl">{listing.title}</h1>
            <PriceTag priceType={listing.priceType} priceCents={listing.priceCents} className="mt-3 text-3xl" />
            <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-600">
              {listing.location ? (
                <div className="flex items-center gap-1.5">
                  <MapPin className="size-4" aria-hidden="true" />
                  <dt className="sr-only">Ort</dt>
                  <dd>{listing.location.postalCode} {listing.location.place}, {listing.location.state}</dd>
                </div>
              ) : null}
              {listing.publishedAt ? (
                <div className="flex items-center gap-1.5">
                  <CalendarDays className="size-4" aria-hidden="true" />
                  <dt className="sr-only">Veröffentlicht</dt>
                  <dd>Online seit {formatDate(listing.publishedAt)}</dd>
                </div>
              ) : null}
            </dl>
            {Object.entries(listing.attributes).length ? (
              <section className="mt-8">
                <h2 className="font-sans text-lg font-semibold tracking-normal">Weitere Angaben</h2>
                <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                  {Object.entries(listing.attributes).map(([key, value]) => {
                    const field = Object.values(ATTRIBUTE_FIELDS).flat().find((item) => item.key === key);
                    if (!field) return null;
                    return (
                      <div key={key} className="rounded-lg bg-canvas p-3">
                        <dt className="text-xs text-ink-500">{field.label}</dt>
                        <dd className="mt-1 font-semibold text-ink-900">
                          {typeof value === 'number' ? value.toLocaleString('de-AT') : String(value)}{field.unit ? ` ${field.unit}` : ''}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </section>
            ) : null}
            <h2 className="mt-8 font-sans text-lg font-semibold tracking-normal">Beschreibung</h2>
            <div className="mt-3 text-[0.9375rem] leading-relaxed whitespace-pre-line text-ink-800">
              {listing.description || <span className="text-ink-400">Keine Beschreibung.</span>}
            </div>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <span className="flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                {seller.accountType === 'BUSINESS' ? <Store className="size-6" aria-hidden="true" /> : <UserRound className="size-6" aria-hidden="true" />}
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink-900">{seller.companyName ?? seller.displayName}</p>
                <p className="text-sm text-ink-500">Mitglied seit {formatDate(seller.memberSince)}</p>
              </div>
            </div>
            {seller.accountType === 'BUSINESS' ? (
              <p className="mt-3 flex items-center gap-1.5 text-sm text-brand-800">
                <BadgeCheck className="size-4" aria-hidden="true" /> Gewerblicher Anbieter – es gelten Verbraucherrechte.
              </p>
            ) : (
              <p className="mt-3 text-sm text-ink-500">Privatverkauf – Gewährleistung kann ausgeschlossen sein.</p>
            )}
            <Button className="mt-5 w-full" size="lg" disabled title="Der Chat folgt in Phase 3">
              <MessageCircle className="size-5" aria-hidden="true" /> Nachricht schreiben
            </Button>
            <p className="mt-2 text-center text-xs text-ink-500">Nachrichten sind bald verfügbar.</p>
          </Card>
          <Link href={`/melden?anzeige=${listing.id}`} className="flex items-center justify-center gap-1.5 text-sm text-ink-500 hover:text-danger-600 hover:underline">
            <Flag className="size-4" aria-hidden="true" /> Anzeige melden
          </Link>
        </aside>
      </div>
    </div>
  );
}

function OwnerBar({ listing }: { listing: ListingDetail }) {
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-brand-200 bg-brand-50 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-sm text-brand-900">
        <span className="font-semibold">Deine Anzeige</span>
        <ListingStatusBadge status={listing.status} />
        {listing.expiresAt && listing.status === 'ACTIVE' ? <span>· läuft bis {formatDate(listing.expiresAt)}</span> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={`/anzeige/${listing.id}/bearbeiten`} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
          <Pencil className="size-4" aria-hidden="true" /> Bearbeiten
        </Link>
        <Link href={`/anzeige/${listing.id}/bilder`} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
          <Images className="size-4" aria-hidden="true" /> Bilder ({listing.images.length})
        </Link>
        <form action={listingStatusAction}>
          <input type="hidden" name="id" value={listing.id} />
          <input type="hidden" name="returnTo" value="detail" />
          {listing.status === 'ACTIVE' ? (
            <button name="action" value="pause" className={buttonClasses({ variant: 'outline', size: 'sm' })}>Pausieren</button>
          ) : listing.status === 'PAUSED' ? (
            <button name="action" value="resume" className={buttonClasses({ size: 'sm' })}>Fortsetzen</button>
          ) : listing.status === 'DRAFT' || listing.status === 'EXPIRED' ? (
            <button name="action" value="publish" className={buttonClasses({ size: 'sm' })}>
              {listing.status === 'DRAFT' ? 'Veröffentlichen' : 'Verlängern'}
            </button>
          ) : null}
        </form>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-6">
        <Skeleton className="aspect-[16/10]" />
        <Skeleton className="h-64" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
