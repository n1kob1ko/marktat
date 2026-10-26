import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { Container, Skeleton } from '@marktat/ui';
import type { ListingDetail } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { getCategories } from '@/lib/data';
import { ListingForm } from '@/components/listing-form/listing-form';
import { updateListingAction } from '@/components/listing-form/actions';

export const metadata: Metadata = { title: 'Anzeige bearbeiten', robots: { index: false } };

export default function EditListingPage({ params }: PageProps<'/anzeige/[id]/bearbeiten'>) {
  return (
    <Container className="py-8 sm:py-10">
      <h1 className="text-3xl font-bold text-ink-950 sm:text-4xl">Anzeige bearbeiten</h1>
      <div className="mt-8">
        <Suspense fallback={<Skeleton className="h-[40rem]" />}>
          <EditForm params={params} />
        </Suspense>
      </div>
    </Container>
  );
}

async function EditForm({ params }: Pick<PageProps<'/anzeige/[id]/bearbeiten'>, 'params'>) {
  const { id } = await params;
  const { token } = await requireUser(`/anzeige/${id}/bearbeiten`);
  let listing: ListingDetail;
  try {
    listing = await api<ListingDetail>(`/listings/${encodeURIComponent(id)}`, { token, cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  if (!listing.isOwner) notFound();
  const categories = await getCategories();
  return <ListingForm categories={categories} action={updateListingAction} listing={listing} />;
}
