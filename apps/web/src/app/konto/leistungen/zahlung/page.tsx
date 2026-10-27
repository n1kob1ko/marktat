import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { Alert, buttonClasses, Card, Skeleton } from '@marktat/ui';
import { formatAmountCents, formatDateTime, type BookingDto } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';

export const metadata: Metadata = { title: 'Zahlung', robots: { index: false } };

const ID_PATTERN = /^[a-z0-9]{20,40}$/;

/**
 * Rückkehr von Stripe Checkout. Freigeschaltet wird nie wegen dieses Aufrufs: die API fragt den Zahlungsstatus
 * selbst bei Stripe ab (bzw. wartet auf den signierten Webhook). Abgebrochen = Buchung ohne Kosten beenden.
 */
export default function PaymentReturnPage({ searchParams }: PageProps<'/konto/leistungen/zahlung'>) {
  return (
    <Suspense fallback={<Skeleton className="h-48" />}>
      <PaymentReturn searchParams={searchParams} />
    </Suspense>
  );
}

async function PaymentReturn({ searchParams }: Pick<PageProps<'/konto/leistungen/zahlung'>, 'searchParams'>) {
  const params = await searchParams;
  const bookingId = typeof params.buchung === 'string' ? params.buchung : '';
  if (!ID_PATTERN.test(bookingId)) notFound();
  const cancelled = params.abgebrochen === '1';
  const { token } = await requireUser(`/konto/leistungen`);

  let booking: BookingDto;
  try {
    booking = await api<BookingDto>(`/bookings/${bookingId}/${cancelled ? 'cancel' : 'confirm'}`, { method: 'POST', token, cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const listingHref = booking.listing ? `/konto/anzeigen/${booking.listing.id}/leistungen` : '/konto/anzeigen';
  return (
    <Card className="mx-auto max-w-xl space-y-4 p-6">
      <h2 className="font-sans text-lg font-semibold tracking-normal">{booking.product.name}</h2>
      {booking.status === 'ACTIVE' || booking.status === 'COMPLETED' ? (
        <Alert tone="success">
          Danke! Die Zahlung über {formatAmountCents(booking.priceCents)} ist bestätigt.
          {booking.endsAt ? ` Die Leistung läuft bis ${formatDateTime(booking.endsAt)}.` : ' Die Leistung ist ausgeführt.'}
        </Alert>
      ) : booking.status === 'PENDING_PAYMENT' ? (
        <Alert tone="info">
          Die Zahlung ist noch nicht bestätigt. Das kann einen Moment dauern – sobald Stripe sie bestätigt, wird die Leistung automatisch aktiv. Du
          findest den Stand unter „Meine Leistungen“.
        </Alert>
      ) : (
        <Alert tone="warning">Die Zahlung wurde abgebrochen. Es wurde nichts verrechnet, und die Leistung ist nicht aktiv.</Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Link href="/konto/leistungen" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
          Meine Leistungen
        </Link>
        <Link href={listingHref} className={buttonClasses({ size: 'sm' })}>
          Zur Anzeige
        </Link>
      </div>
    </Card>
  );
}
