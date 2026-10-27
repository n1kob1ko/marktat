import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowRight, Pencil } from 'lucide-react';
import { Alert, buttonClasses, Card, Container, Skeleton } from '@marktat/ui';
import type { ListingDetail, ListingImage } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { ImageManager } from '@/components/image-manager/image-manager';
import { ListingStatusBadge } from '@/components/listing-status-badge';

export const metadata: Metadata = { title: 'Bilder verwalten', robots: { index: false } };

export default function ListingImagesPage({
  params,
  searchParams,
}: PageProps<'/anzeige/[id]/bilder'>) {
  return (
    <Container className="py-8 sm:py-10">
      <Suspense fallback={<Skeleton className="h-[32rem]" />}>
        <Content params={params} searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

/** Wohin „Fertig“ führt: nach dem Anlegen dorthin, wo es ohne Bilder-Schritt hingegangen wäre. */
function doneHref(id: string, neu: string | undefined) {
  if (neu === 'veroeffentlicht') return `/anzeige/${id}?hinweis=veroeffentlicht`;
  if (neu === 'entwurf') return '/konto/anzeigen?hinweis=entwurf';
  return `/anzeige/${id}`;
}

async function Content({
  params,
  searchParams,
}: Pick<PageProps<'/anzeige/[id]/bilder'>, 'params' | 'searchParams'>) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { token } = await requireUser(`/anzeige/${id}/bilder`);
  let listing: ListingDetail;
  let images: ListingImage[];
  try {
    [listing, images] = await Promise.all([
      api<ListingDetail>(`/listings/${encodeURIComponent(id)}`, { token, cache: 'no-store' }),
      api<ListingImage[]>(`/listings/${encodeURIComponent(id)}/images`, {
        token,
        cache: 'no-store',
      }),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  if (!listing.isOwner) notFound();
  const neu = typeof query.neu === 'string' ? query.neu : undefined;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm text-ink-500">
            <ListingStatusBadge status={listing.status} />
            <span className="truncate">{listing.title}</span>
          </p>
          <h1 className="mt-2 text-3xl font-bold text-ink-950 sm:text-4xl">Bilder</h1>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/anzeige/${listing.id}/bearbeiten`}
            className={buttonClasses({ variant: 'outline' })}
          >
            <Pencil className="size-4" aria-hidden="true" /> Angaben bearbeiten
          </Link>
          <Link href={doneHref(listing.id, neu)} className={buttonClasses()}>
            Fertig <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
      {neu === 'veroeffentlicht' ? (
        <Alert tone="success">
          Deine Anzeige ist online. Füge jetzt Bilder hinzu – das erste Bild ist das Hauptbild.
        </Alert>
      ) : neu === 'entwurf' ? (
        <Alert tone="info">
          Dein Entwurf ist gespeichert. Du kannst jetzt schon Bilder hinzufügen.
        </Alert>
      ) : null}
      <Card className="p-5 sm:p-7">
        <ImageManager listingId={listing.id} initialImages={images} />
      </Card>
    </div>
  );
}
