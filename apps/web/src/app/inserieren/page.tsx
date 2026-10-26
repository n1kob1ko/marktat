import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Container, Skeleton } from '@marktat/ui';
import { requireUser } from '@/lib/auth';
import { getCategories } from '@/lib/data';
import { ListingForm } from '@/components/listing-form/listing-form';
import { createListingAction } from '@/components/listing-form/actions';

export const metadata: Metadata = { title: 'Inserat aufgeben', robots: { index: false } };

export default function NewListingPage() {
  return (
    <Container className="py-8 sm:py-10">
      <h1 className="text-3xl font-bold text-ink-950 sm:text-4xl">Inserat aufgeben</h1>
      <p className="mt-2 text-ink-600">Fülle die Angaben aus – rechts siehst du, wie deine Anzeige aussehen wird.</p>
      <div className="mt-8">
        <Suspense fallback={<Skeleton className="h-[40rem]" />}>
          <NewListingForm />
        </Suspense>
      </div>
    </Container>
  );
}

async function NewListingForm() {
  await requireUser('/inserieren');
  const categories = await getCategories();
  return <ListingForm categories={categories} action={createListingAction} />;
}
