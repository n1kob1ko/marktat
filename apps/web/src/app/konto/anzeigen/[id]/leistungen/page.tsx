import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowLeft, BarChart3, CalendarClock } from 'lucide-react';
import { Badge, buttonClasses, Card, Skeleton } from '@marktat/ui';
import { formatAmountCents, formatDateTime, type ListingDetail, type ListingPromotionOption } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { getPublicBilling, newIdempotencyKey } from '@/lib/billing';
import { FlashMessage } from '@/components/flash-message';
import { ListingStatusBadge } from '@/components/listing-status-badge';
import { SubmitButton } from '@/components/submit-button';
import { bookPromotionAction } from '../../actions';

export const metadata: Metadata = { title: 'Leistungen für meine Anzeige', robots: { index: false } };

export default function ListingPromotionsPage({ params, searchParams }: PageProps<'/konto/anzeigen/[id]/leistungen'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <ListingPromotions params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ListingPromotions({ params, searchParams }: PageProps<'/konto/anzeigen/[id]/leistungen'>) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { token } = await requireUser(`/konto/anzeigen/${id}/leistungen`);
  let listing: ListingDetail;
  let options: ListingPromotionOption[];
  try {
    [listing, options] = await Promise.all([
      api<ListingDetail>(`/listings/${encodeURIComponent(id)}`, { token, cache: 'no-store' }),
      api<ListingPromotionOption[]>(`/listings/${encodeURIComponent(id)}/promotions`, { token, cache: 'no-store' }),
    ]);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  if (!listing.isOwner) notFound();
  const billing = await getPublicBilling();
  const listingProduct = billing?.products.find((p) => p.code === 'listing');
  const needsPaidPublish = listingProduct?.requiresPayment && (listing.status === 'DRAFT' || listing.status === 'EXPIRED');

  return (
    <div className="space-y-5">
      <Link href="/konto/anzeigen" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Meine Anzeigen
      </Link>
      <FlashMessage hinweis={typeof query.hinweis === 'string' ? query.hinweis : undefined} fehler={typeof query.fehler === 'string' ? query.fehler : undefined} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <ListingStatusBadge status={listing.status} />
          <h2 className="mt-2 truncate font-sans text-xl font-semibold tracking-normal text-ink-950">{listing.title}</h2>
          {billing?.mode === 'FREE' ? <p className="mt-1 text-sm text-ink-600">Alle Leistungen sind während der Einführungsphase kostenlos.</p> : null}
        </div>
        <Link href={`/konto/anzeigen/${listing.id}/statistik`} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
          <BarChart3 className="size-4" aria-hidden="true" /> Statistik
        </Link>
      </div>

      {needsPaidPublish && listingProduct ? (
        <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="font-semibold text-ink-900">{listing.status === 'DRAFT' ? 'Veröffentlichen' : 'Verlängern'}</p>
            <p className="text-sm text-ink-600">
              {formatAmountCents(listingProduct.priceCents)} für {listingProduct.durationDays ?? 60} Tage. Bezahlt wird sicher über Stripe; online geht die Anzeige erst nach bestätigter Zahlung.
            </p>
          </div>
          <BookForm listingId={listing.id} product="listing" label={`Für ${formatAmountCents(listingProduct.priceCents)} buchen`} />
        </Card>
      ) : null}

      <ul className="grid gap-4 md:grid-cols-3">
        {options.map((option) => (
          <li key={option.code} className="flex">
            <Card className="flex w-full flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-sans text-base font-semibold tracking-normal text-ink-900">{option.name}</h3>
                <span className="text-right text-sm font-semibold whitespace-nowrap text-ink-900 tabular-nums">
                  {formatAmountCents(option.priceCents)}
                  {!option.requiresPayment ? <span className="block text-xs font-normal text-ink-500">kostenlos</span> : null}
                </span>
              </div>
              <p className="text-sm leading-relaxed text-ink-600">{option.description}</p>
              <p className="flex items-center gap-1.5 text-xs text-ink-500">
                <CalendarClock className="size-3.5" aria-hidden="true" />
                {option.durationDays ? `Laufzeit ${option.durationDays} ${option.durationDays === 1 ? 'Tag' : 'Tage'}, endet automatisch` : 'Einmalig, ohne Laufzeit'}
              </p>
              <div className="mt-auto space-y-2 pt-2">
                {option.activeUntil ? <Badge tone="accent">Aktiv bis {formatDateTime(option.activeUntil)}</Badge> : null}
                {option.available ? (
                  <BookForm
                    listingId={listing.id}
                    product={option.code}
                    label={option.requiresPayment ? `Für ${formatAmountCents(option.priceCents)} buchen` : `${option.name} aktivieren`}
                  />
                ) : option.unavailableReason && !option.activeUntil ? (
                  <p className="rounded-lg bg-canvas px-3 py-2 text-sm text-ink-700">{option.unavailableReason}</p>
                ) : null}
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <p className="text-xs leading-relaxed text-ink-500">
        Leistungen ändern nichts an deiner Anzeige selbst. Sie enden automatisch; danach wird die Anzeige wieder normal angezeigt. Limits schützen vor
        Missbrauch und sorgen dafür, dass alle fair drankommen.
      </p>
    </div>
  );
}

function BookForm({ listingId, product, label }: { listingId: string; product: string; label: string }) {
  return (
    <form action={bookPromotionAction}>
      <input type="hidden" name="id" value={listingId} />
      <input type="hidden" name="product" value={product} />
      <input type="hidden" name="key" value={newIdempotencyKey()} />
      <input type="hidden" name="returnTo" value="leistungen" />
      <SubmitButton size="sm" className="w-full sm:w-auto">
        {label}
      </SubmitButton>
    </form>
  );
}
