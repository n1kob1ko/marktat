import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { Alert, Card, Container, Skeleton } from '@marktat/ui';
import type { DealDetail, ListingDetail } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { ENTITY_ID } from '@/lib/admin';
import { LegalPage } from '@/components/legal-page';
import { ReportListingForm } from './report-form';

export const metadata: Metadata = { title: 'Inhalte melden', robots: { index: false } };

export default function ReportPage({ searchParams }: PageProps<'/melden'>) {
  return (
    <Suspense fallback={<Skeleton className="mx-auto my-10 h-96 max-w-3xl" />}>
      <ReportContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ReportContent({ searchParams }: Pick<PageProps<'/melden'>, 'searchParams'>) {
  const params = await searchParams;
  const dealId = typeof params.deal === 'string' ? params.deal : undefined;
  if (dealId) return <ReportDeal dealId={dealId} />;
  const listingId = typeof params.anzeige === 'string' ? params.anzeige : undefined;
  if (!listingId) return <ReportInfo />;
  if (!ENTITY_ID.test(listingId)) notFound();

  const { token } = await requireUser(`/melden?anzeige=${listingId}`);
  let listing: ListingDetail;
  try {
    listing = await api<ListingDetail>(`/listings/${listingId}`, { token, cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <Container className="max-w-3xl py-10 sm:py-14">
      <h1 className="text-3xl font-bold text-ink-950 sm:text-4xl">Anzeige melden</h1>
      <p className="mt-3 text-ink-600">
        Du meldest:{' '}
        <Link href={`/anzeige/${listing.id}`} className="font-semibold text-brand-700 hover:underline">
          {listing.title}
        </Link>
      </p>
      <Card className="mt-6 p-5 sm:p-7">
        {listing.isOwner ? (
          <Alert tone="info">Das ist deine eigene Anzeige. Du kannst sie bearbeiten oder löschen, aber nicht melden.</Alert>
        ) : (
          <ReportListingForm listingId={listing.id} />
        )}
      </Card>
    </Container>
  );
}

async function ReportDeal({ dealId }: { dealId: string }) {
  if (!ENTITY_ID.test(dealId)) notFound();
  const { token } = await requireUser(`/melden?deal=${dealId}`);
  let deal: DealDetail;
  try {
    deal = await api<DealDetail>(`/deals/${dealId}`, { token, cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  return (
    <Container className="max-w-3xl py-10 sm:py-14">
      <h1 className="text-3xl font-bold text-ink-950 sm:text-4xl">Angebot melden</h1>
      <p className="mt-3 text-ink-600">
        Du meldest:{' '}
        <Link href={`/deals/${deal.id}`} className="font-semibold text-brand-700 hover:underline">
          {deal.title}
        </Link>{' '}
        von {deal.merchant.name}
      </p>
      <Card className="mt-6 p-5 sm:p-7">
        {deal.isOwner ? <Alert tone="info">Das ist dein eigenes Angebot. Du kannst es bearbeiten oder löschen, aber nicht melden.</Alert> : <ReportListingForm dealId={deal.id} />}
      </Card>
    </Container>
  );
}

function ReportInfo() {
  return (
    <LegalPage title="Inhalte melden">
      <p>
        Du hast eine betrügerische, rechtswidrige oder gegen unsere Regeln verstoßende Anzeige entdeckt? Öffne die Anzeige und wähle unter den Angaben zum Anbieter{' '}
        <strong>„Anzeige melden“</strong>. Deals meldest du auf der Seite des Angebots über <strong>„Angebot melden“</strong>, Unterhaltungen direkt im Chat über das Menü.
      </p>
      <p>
        Jede Meldung prüft ein Mensch aus unserem Team. Wir sperren nicht automatisch, nur weil eine Anzeige mehrmals gemeldet wurde. Über das Ergebnis informieren wir dich in deinem
        Konto unter „Mitteilungen“.
      </p>
      <p>Bei akuter Gefahr wende dich bitte direkt an die Polizei (133) oder den Notruf (112).</p>
      <p>Ohne Konto: Meldungen bitte an [Kontakt-E-Mail des Betreibers] mit dem Link zur Anzeige.</p>
    </LegalPage>
  );
}
