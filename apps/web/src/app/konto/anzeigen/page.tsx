import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { BarChart3, MapPin, Pencil, Plus, Sparkles } from 'lucide-react';
import { Badge, buttonClasses, Card, Skeleton } from '@marktat/ui';
import { formatAmountCents, formatDate, formatDateTime, type ListingSummary, type PublicBillingInfo } from '@marktat/shared';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { FlashMessage } from '@/components/flash-message';
import { ListingStatusBadge } from '@/components/listing-status-badge';
import { PriceTag } from '@/components/price-tag';
import { ConfirmDeleteButton } from '@/components/confirm-delete-button';
import { SubmitButton } from '@/components/submit-button';
import { getPublicBilling, newIdempotencyKey } from '@/lib/billing';
import { bookPromotionAction, listingStatusAction } from './actions';

export const metadata: Metadata = { title: 'Meine Anzeigen', robots: { index: false } };

export default function MyListingsPage({ searchParams }: PageProps<'/konto/anzeigen'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <MyListings searchParams={searchParams} />
    </Suspense>
  );
}

async function MyListings({ searchParams }: Pick<PageProps<'/konto/anzeigen'>, 'searchParams'>) {
  const [{ token, user }, params] = await Promise.all([requireUser('/konto/anzeigen'), searchParams]);
  const [listings, billing] = await Promise.all([api<ListingSummary[]>('/listings/mine', { token, cache: 'no-store' }), getPublicBilling()]);
  const hinweis = typeof params.hinweis === 'string' ? params.hinweis : undefined;
  const fehler = typeof params.fehler === 'string' ? params.fehler : undefined;

  return (
    <div className="space-y-4">
      <FlashMessage hinweis={hinweis} fehler={fehler} />
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-ink-600">{listings.length} {listings.length === 1 ? 'Anzeige' : 'Anzeigen'}</p>
        <div className="flex flex-wrap justify-end gap-2">
          {user.accountType === 'BUSINESS' ? (
            <Link href="/konto/haendler" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
              Händler-Dashboard
            </Link>
          ) : null}
          <Link href="/konto/leistungen" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
            Meine Leistungen
          </Link>
          <Link href="/inserieren" className={buttonClasses({ size: 'sm' })}>
            <Plus className="size-4" aria-hidden="true" /> Neue Anzeige
          </Link>
        </div>
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
                  <ActivePromotions listing={listing} />
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                {listing.status === 'ACTIVE' ? <PromotionButtons listing={listing} billing={billing} /> : null}
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  <Link href={`/konto/anzeigen/${listing.id}/statistik`} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
                    <BarChart3 className="size-4" aria-hidden="true" /> Statistik
                  </Link>
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
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Laufende Zusatzleistungen mit Enddatum */
function ActivePromotions({ listing }: { listing: ListingSummary }) {
  const until = listing.promotionsUntil;
  const items = [
    ...(listing.top && until?.top ? [`Top-Anzeige bis ${formatDateTime(until.top)}`] : []),
    ...(listing.highlighted && until?.highlighted ? [`Hervorgehoben bis ${formatDateTime(until.highlighted)}`] : []),
    ...(listing.bumpedAt ? [`Hochgeschoben am ${formatDateTime(listing.bumpedAt)}`] : []),
  ];
  if (!items.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5 pt-1" aria-label="Aktive Leistungen">
      {items.map((item) => (
        <li key={item}>
          <Badge tone="accent">{item}</Badge>
        </li>
      ))}
    </ul>
  );
}

/**
 * Schnellbuchung je Leistung (eigenes Formular, eigener Schlüssel gegen Doppelklicks). Läuft eine Leistung schon,
 * gibt es keinen Knopf; Limits und Mindestabstände prüft die API – Details stehen auf der Leistungsseite.
 */
function PromotionButtons({ listing, billing }: { listing: ListingSummary; billing: PublicBillingInfo | null }) {
  const product = (code: string) => billing?.products.find((p) => p.code === code);
  const buttons = [
    ...(!listing.highlighted ? [{ product: 'highlight', label: 'Hervorheben' }] : []),
    ...(!listing.top ? [{ product: 'top', label: 'Top-Anzeige' }] : []),
    { product: 'bump', label: 'Hochschieben' },
  ]
    // Ohne Preisinformation oder für deaktivierte Leistungen keine Knöpfe
    .filter((button) => product(button.product)?.isActive)
    .map((button) => {
      const info = product(button.product)!;
      return { ...button, label: info.requiresPayment ? `${button.label} · ${formatAmountCents(info.priceCents)}` : button.label };
    });
  return (
    <div className="flex flex-wrap gap-2 sm:justify-end">
      {buttons.map((button) => (
        <form key={button.product} action={bookPromotionAction}>
          <input type="hidden" name="id" value={listing.id} />
          <input type="hidden" name="product" value={button.product} />
          <input type="hidden" name="key" value={newIdempotencyKey()} />
          <SubmitButton variant="secondary" size="sm">
            {button.label}
          </SubmitButton>
        </form>
      ))}
      <Link href={`/konto/anzeigen/${listing.id}/leistungen`} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
        <Sparkles className="size-4" aria-hidden="true" /> Leistungen
      </Link>
    </div>
  );
}
