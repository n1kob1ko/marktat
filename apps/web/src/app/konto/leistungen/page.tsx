import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Alert, Badge, Card, Skeleton, type BadgeTone } from '@marktat/ui';
import {
  BOOKING_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  formatAmountCents,
  formatDate,
  formatDateTime,
  type BookingDto,
  type BookingStatus,
  type MyBillingOverview,
  type ProductUsage,
} from '@marktat/shared';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { IntroBanner } from '@/components/billing/intro-banner';
import { Pagination } from '@/components/pagination';

export const metadata: Metadata = { title: 'Meine Leistungen', robots: { index: false } };

const STATUS_TONES: Record<BookingStatus, BadgeTone> = {
  PENDING_PAYMENT: 'warning',
  ACTIVE: 'success',
  COMPLETED: 'neutral',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
  REFUNDED: 'neutral',
};

export default function MyServicesPage({ searchParams }: PageProps<'/konto/leistungen'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <MyServices searchParams={searchParams} />
    </Suspense>
  );
}

async function MyServices({ searchParams }: Pick<PageProps<'/konto/leistungen'>, 'searchParams'>) {
  const [{ token }, params] = await Promise.all([requireUser('/konto/leistungen'), searchParams]);
  const page = Math.max(1, Number.parseInt(typeof params.seite === 'string' ? params.seite : '1', 10) || 1);
  const overview = await api<MyBillingOverview>(`/me/billing?page=${page}`, { token, cache: 'no-store' });
  const totalPages = Math.ceil(overview.history.total / overview.history.pageSize);
  const payments = overview.history.items.filter((booking) => booking.payment);

  return (
    <div className="space-y-6">
      {overview.mode === 'FREE' ? (
        <Alert tone="success">
          Alle Leistungen sind derzeit kostenlos. Es werden keine Zahlungsdaten erfasst, und für kostenlos gebuchte Leistungen fällt auch später nichts an.
        </Alert>
      ) : null}
      {overview.intro ? <IntroBanner intro={overview.intro} /> : null}

      <section aria-labelledby="usage-heading" className="space-y-3">
        <h2 id="usage-heading" className="font-sans text-lg font-semibold tracking-normal">Kontingent</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {overview.usage.map((usage) => (
            <li key={usage.code}>
              <UsageCard usage={usage} />
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-500">Die Grenzen schützen vor Missbrauch und sorgen dafür, dass alle Anzeigen fair drankommen.</p>
      </section>

      <section aria-labelledby="active-heading" className="space-y-3">
        <h2 id="active-heading" className="font-sans text-lg font-semibold tracking-normal">Laufende Leistungen</h2>
        {overview.activeBookings.length ? (
          <BookingList bookings={overview.activeBookings} />
        ) : (
          <Card className="p-5 text-sm text-ink-600">
            Gerade läuft nichts. Unter <Link href="/konto/anzeigen" className="font-semibold text-brand-700 hover:underline">Meine Anzeigen</Link> kannst du Anzeigen hervorheben,
            als Top-Anzeige zeigen oder hochschieben.
          </Card>
        )}
      </section>

      <section aria-labelledby="history-heading" className="space-y-3">
        <h2 id="history-heading" className="font-sans text-lg font-semibold tracking-normal">Verlauf</h2>
        {overview.history.items.length ? (
          <>
            <BookingList bookings={overview.history.items} />
            <Pagination page={page} totalPages={totalPages} hrefFor={(p) => (p === 1 ? '/konto/leistungen' : `/konto/leistungen?seite=${p}`)} />
          </>
        ) : (
          <Card className="p-5 text-sm text-ink-600">Noch keine Buchungen. Auch kostenlose Veröffentlichungen erscheinen hier.</Card>
        )}
      </section>

      <section aria-labelledby="payments-heading" className="space-y-3">
        <h2 id="payments-heading" className="font-sans text-lg font-semibold tracking-normal">Zahlungen</h2>
        {payments.length ? (
          <Card className="divide-y divide-line">
            {payments.map((booking) => (
              <div key={booking.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
                <span className="text-ink-900">
                  {booking.product.name}
                  {booking.listing ? <span className="text-ink-500"> · {booking.listing.title}</span> : null}
                </span>
                <span className="flex items-center gap-3 tabular-nums">
                  {formatAmountCents(booking.payment!.amountCents)}
                  <Badge>{PAYMENT_STATUS_LABELS[booking.payment!.status]}</Badge>
                  {booking.payment!.receiptUrl ? (
                    <a href={booking.payment!.receiptUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-700 hover:underline">
                      Beleg
                    </a>
                  ) : null}
                </span>
              </div>
            ))}
          </Card>
        ) : (
          <Card className="p-5 text-sm text-ink-600">
            Keine Zahlungen{overview.history.total > overview.history.pageSize ? ' auf dieser Seite' : ''}. Solange MarktAT kostenlos ist, fallen keine an.
          </Card>
        )}
      </section>
    </div>
  );
}

function UsageCard({ usage }: { usage: ProductUsage }) {
  const rows = [
    ...(usage.maxActivePerUser !== null ? [`${usage.active} von ${usage.maxActivePerUser} gleichzeitig aktiv`] : usage.kind === 'BUMP' ? [] : [`${usage.active} aktiv`]),
    usage.maxPerPeriod !== null ? `${usage.usedInPeriod} von ${usage.maxPerPeriod} in ${usage.periodDays} Tagen genutzt` : `${usage.usedInPeriod} in ${usage.periodDays} Tagen`,
    ...(usage.cooldownHours ? [`Mindestabstand ${usage.cooldownHours} Stunden je Anzeige`] : []),
  ];
  return (
    <Card className="h-full p-4">
      <p className="font-semibold text-ink-900">{usage.name}</p>
      <ul className="mt-2 space-y-1 text-sm text-ink-600">
        {rows.map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
    </Card>
  );
}

function BookingList({ bookings }: { bookings: BookingDto[] }) {
  return (
    <Card className="divide-y divide-line">
      {bookings.map((booking) => (
        <div key={booking.id} className="flex flex-col gap-2 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-semibold text-ink-900">
              {booking.product.name}
              {booking.listing ? (
                <Link href={`/anzeige/${booking.listing.id}`} className="ml-2 font-normal text-brand-700 hover:underline">
                  {booking.listing.title}
                </Link>
              ) : (
                <span className="ml-2 font-normal text-ink-500">Anzeige gelöscht</span>
              )}
            </p>
            <p className="mt-0.5 text-ink-500">
              Gebucht am {formatDate(booking.createdAt)}
              {booking.endsAt ? ` · ${booking.status === 'ACTIVE' ? 'läuft bis' : 'bis'} ${formatDateTime(booking.endsAt)}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="tabular-nums text-ink-900">{booking.priceCents === 0 ? 'kostenlos' : formatAmountCents(booking.priceCents)}</span>
            <Badge tone={STATUS_TONES[booking.status]}>{BOOKING_STATUS_LABELS[booking.status]}</Badge>
          </div>
        </div>
      ))}
    </Card>
  );
}
