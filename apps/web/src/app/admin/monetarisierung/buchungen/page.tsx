import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { Badge, Skeleton } from '@marktat/ui';
import {
  BOOKING_STATUSES,
  BOOKING_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  PRODUCT_CODES,
  formatAmountCents,
  formatDateTime,
  type AdminBookingDto,
  type Paginated,
} from '@marktat/shared';
import { api } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { pick, totalPages, withQuery } from '@/lib/admin';
import { Pagination } from '@/components/pagination';
import { EmptyState, FilterBar, FilterSelect, PageTitle, table } from '@/components/admin/admin-ui';

export const metadata: Metadata = { title: 'Buchungen' };

const FILTERS = ['status', 'product', 'price'] as const;
const PRODUCT_NAMES: Record<(typeof PRODUCT_CODES)[number], string> = { listing: 'Inserat', highlight: 'Hervorhebung', top: 'Top-Anzeige', bump: 'Hochschieben' };

export default function BookingsPage({ searchParams }: PageProps<'/admin/monetarisierung/buchungen'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Bookings searchParams={searchParams} />
    </Suspense>
  );
}

async function Bookings({ searchParams }: Pick<PageProps<'/admin/monetarisierung/buchungen'>, 'searchParams'>) {
  const [{ user, token }, params] = await Promise.all([requireStaff('/admin/monetarisierung/buchungen'), searchParams]);
  if (user.role !== 'ADMIN') notFound();
  const filters = pick(params, FILTERS);
  const page = Number(pick(params, ['page']).page ?? 1) || 1;
  const result = await api<Paginated<AdminBookingDto>>(withQuery('/admin/billing/bookings', { ...filters, page }), { token, cache: 'no-store' });

  return (
    <div className="space-y-5">
      <PageTitle
        title="Buchungen"
        description="Alle Buchungen mit dem Preis zum Buchungszeitpunkt. Kostenlose Buchungen bleiben kostenlos, auch wenn sich Preise später ändern."
        actions={<Link href="/admin/monetarisierung" className="text-sm font-semibold text-brand-700 hover:underline">Zur Monetarisierung</Link>}
      />
      <FilterBar action="/admin/monetarisierung/buchungen">
        <FilterSelect name="status" label="Status" value={filters.status} options={[{ value: '', label: 'Alle' }, ...BOOKING_STATUSES.map((s) => ({ value: s, label: BOOKING_STATUS_LABELS[s] }))]} />
        <FilterSelect name="product" label="Leistung" value={filters.product} options={[{ value: '', label: 'Alle' }, ...PRODUCT_CODES.map((c) => ({ value: c, label: PRODUCT_NAMES[c] }))]} />
        <FilterSelect name="price" label="Preis" value={filters.price} options={[{ value: '', label: 'Alle' }, { value: 'free', label: 'kostenlos' }, { value: 'paid', label: 'bezahlt' }]} />
      </FilterBar>
      {result.items.length ? (
        <div className={table.wrapper}>
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={table.th}>Leistung</th>
                <th className={table.th}>Konto</th>
                <th className={table.th}>Inserat</th>
                <th className={table.th}>Preis</th>
                <th className={table.th}>Status</th>
                <th className={table.th}>Laufzeit</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((booking) => (
                <tr key={booking.id} className={table.row}>
                  <td className={table.tdMain}>
                    <span className="font-semibold text-ink-900">{booking.product.name}</span>
                    <span className="block text-xs text-ink-500">{formatDateTime(booking.createdAt)}</span>
                  </td>
                  <td className={table.td} data-label="Konto">
                    {booking.user ? (
                      <Link href={`/admin/nutzer/${booking.user.id}`} className="font-medium text-brand-700 hover:underline">{booking.user.displayName}</Link>
                    ) : (
                      <span className="text-ink-500">gelöscht</span>
                    )}
                  </td>
                  <td className={table.td} data-label="Inserat">
                    {booking.listing ? (
                      <Link href={`/admin/inserate/${booking.listing.id}`} className="line-clamp-1 text-brand-700 hover:underline">{booking.listing.title}</Link>
                    ) : (
                      <span className="text-ink-500">–</span>
                    )}
                  </td>
                  <td className={`${table.td} tabular-nums`} data-label="Preis">
                    {booking.priceCents === 0 ? 'kostenlos' : formatAmountCents(booking.priceCents)}
                    {booking.payment ? <span className="block text-xs text-ink-500">{PAYMENT_STATUS_LABELS[booking.payment.status]}</span> : null}
                  </td>
                  <td className={table.td} data-label="Status">
                    <Badge>{BOOKING_STATUS_LABELS[booking.status]}</Badge>
                  </td>
                  <td className={`${table.td} text-xs text-ink-600`} data-label="Laufzeit">
                    {booking.startsAt ? formatDateTime(booking.startsAt) : '–'}
                    {booking.endsAt ? ` bis ${formatDateTime(booking.endsAt)}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>Keine Buchungen mit diesen Filtern.</EmptyState>
      )}
      <Pagination page={page} totalPages={totalPages(result.total, result.pageSize)} hrefFor={(p) => withQuery('/admin/monetarisierung/buchungen', { ...filters, page: p })} />
    </div>
  );
}
