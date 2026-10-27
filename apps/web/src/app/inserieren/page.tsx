import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Container, Skeleton } from '@marktat/ui';
import { formatAmountCents } from '@marktat/shared';
import { requireUser } from '@/lib/auth';
import { getCategories } from '@/lib/data';
import { getPublicBilling } from '@/lib/billing';
import { IntroBanner } from '@/components/billing/intro-banner';
import { ListingForm } from '@/components/listing-form/listing-form';
import { createListingAction } from '@/components/listing-form/actions';

export const metadata: Metadata = { title: 'Inserat aufgeben', robots: { index: false } };

export default function NewListingPage() {
  return (
    <Container className="py-8 sm:py-10">
      <h1 className="text-3xl font-bold text-ink-950 sm:text-4xl">Inserat aufgeben</h1>
      <p className="mt-2 text-ink-600">Fülle die Angaben aus – die Vorschau zeigt dir, wie deine Anzeige aussehen wird.</p>
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
  const [categories, billing] = await Promise.all([getCategories(), getPublicBilling()]);
  const listing = billing?.products.find((p) => p.code === 'listing');
  return (
    <div className="space-y-6">
      {billing?.intro ? <IntroBanner intro={billing.intro} /> : null}
      {listing?.requiresPayment ? (
        <p className="rounded-xl border border-line bg-surface p-4 text-sm text-ink-700" role="note">
          Das Veröffentlichen kostet derzeit {formatAmountCents(listing.priceCents)} für {listing.durationDays ?? 60} Tage. Speichere dein Inserat als Entwurf –
          unter „Meine Anzeigen“ kannst du es danach buchen und bezahlen.
        </p>
      ) : null}
      <ListingForm categories={categories} action={createListingAction} terms={{ days: listing?.durationDays ?? 60, free: !listing?.requiresPayment }} />
    </div>
  );
}
