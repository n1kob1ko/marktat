import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ImageOff } from 'lucide-react';
import { Badge, Skeleton } from '@marktat/ui';
import { formatDateTime, type AdminListingSummary, type Paginated } from '@marktat/shared';
import { api } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { pick, totalPages, withQuery } from '@/lib/admin';
import { Pagination } from '@/components/pagination';
import { ListingStatusBadge } from '@/components/listing-status-badge';
import { EmptyState, FilterBar, FilterSearch, FilterSelect, PageTitle, PersonLink, table, UserStatusBadge } from '@/components/admin/admin-ui';

export const metadata: Metadata = { title: 'Inserate' };

const FILTERS = ['q', 'status'] as const;
const STATUS_OPTIONS = [
  { value: '', label: 'In Prüfung oder gemeldet' },
  { value: 'reported', label: 'Mit offener Meldung' },
  { value: 'PENDING_REVIEW', label: 'Wartet auf Prüfung' },
  { value: 'REJECTED', label: 'Deaktiviert' },
  { value: 'ACTIVE', label: 'Aktiv' },
  { value: 'PAUSED', label: 'Pausiert' },
  { value: 'EXPIRED', label: 'Abgelaufen' },
  { value: 'DRAFT', label: 'Entwurf' },
  { value: 'all', label: 'Alle' },
];

export default function AdminListingsPage({ searchParams }: PageProps<'/admin/inserate'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Listings searchParams={searchParams} />
    </Suspense>
  );
}

async function Listings({ searchParams }: Pick<PageProps<'/admin/inserate'>, 'searchParams'>) {
  const [{ token }, params] = await Promise.all([requireStaff('/admin/inserate'), searchParams]);
  const filters = pick(params, FILTERS);
  const page = Number(pick(params, ['page']).page ?? 1) || 1;
  const result = await api<Paginated<AdminListingSummary>>(withQuery('/admin/listings', { ...filters, page }), { token, cache: 'no-store' });

  return (
    <div className="space-y-5">
      <PageTitle title="Inserate" description={`${result.total.toLocaleString('de-AT')} Inserat(e)`} />
      <FilterBar action="/admin/inserate">
        <FilterSearch label="Titel oder ID" value={filters.q} placeholder="z. B. Rennrad" />
        <FilterSelect name="status" label="Status" value={filters.status} options={STATUS_OPTIONS} />
      </FilterBar>
      {result.items.length ? (
        <div className={table.wrapper}>
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={table.th}>Inserat</th>
                <th className={table.th}>Status</th>
                <th className={table.th}>Anbieter</th>
                <th className={table.th}>Geändert</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((l) => (
                <tr key={l.id} className={table.row}>
                  <td className={table.tdMain}>
                    <div className="flex items-center gap-3">
                      {l.thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- signierte, kurzlebige URLs
                        <img src={l.thumbUrl} alt="" className="size-12 shrink-0 rounded-lg object-cover" />
                      ) : (
                        <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-canvas text-ink-400">
                          <ImageOff className="size-5" aria-hidden="true" />
                        </span>
                      )}
                      <Link href={`/admin/inserate/${l.id}`} className="line-clamp-2 font-semibold text-ink-900 hover:text-brand-700 hover:underline">
                        {l.title}
                      </Link>
                    </div>
                  </td>
                  <td className={table.td} data-label="Status">
                    <span className="flex flex-wrap gap-1.5">
                      <ListingStatusBadge status={l.status} />
                      {l.openReports ? <Badge tone="danger">{l.openReports} Meldung(en)</Badge> : null}
                    </span>
                  </td>
                  <td className={table.td} data-label="Anbieter">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <PersonLink person={l.seller} />
                      {l.seller.status !== 'ACTIVE' ? <UserStatusBadge status={l.seller.status} /> : null}
                    </span>
                  </td>
                  <td className={table.td} data-label="Geändert">{formatDateTime(l.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>Keine Inserate mit diesen Filtern.</EmptyState>
      )}
      <Pagination page={result.page} totalPages={totalPages(result.total, result.pageSize)} hrefFor={(p) => withQuery('/admin/inserate', { ...filters, page: p })} />
    </div>
  );
}
