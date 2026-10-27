import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ImageOff } from 'lucide-react';
import { Badge, Skeleton } from '@marktat/ui';
import { ADMIN_DEAL_FILTER_LABELS, ADMIN_DEAL_FILTERS, formatDateTime, formatPriceCents, type AdminDealSummary, type Paginated } from '@marktat/shared';
import { api } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { pick, totalPages, withQuery } from '@/lib/admin';
import { Pagination } from '@/components/pagination';
import { DealStatusBadge } from '@/components/deals/deal-status-badge';
import { EmptyState, FilterBar, FilterSearch, FilterSelect, PageTitle, table, UserStatusBadge } from '@/components/admin/admin-ui';

export const metadata: Metadata = { title: 'Deals' };

const FILTERS = ['q', 'filter', 'merchant'] as const;
const FILTER_OPTIONS = ADMIN_DEAL_FILTERS.map((value) => ({ value: value === 'review' ? '' : value, label: ADMIN_DEAL_FILTER_LABELS[value] }));

export default function AdminDealsPage({ searchParams }: PageProps<'/admin/deals'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Deals searchParams={searchParams} />
    </Suspense>
  );
}

async function Deals({ searchParams }: Pick<PageProps<'/admin/deals'>, 'searchParams'>) {
  const [{ token }, params] = await Promise.all([requireStaff('/admin/deals'), searchParams]);
  const filters = pick(params, FILTERS);
  const page = Number(pick(params, ['page']).page ?? 1) || 1;
  const result = await api<Paginated<AdminDealSummary>>(withQuery('/admin/deals', { ...filters, page }), { token, cache: 'no-store' });

  return (
    <div className="space-y-5">
      <PageTitle
        title="Deals"
        description={`${result.total.toLocaleString('de-AT')} Angebot(e). Hohe Rabatte, defekte Links, fehlende Bestätigungen und mögliche Doppelte lassen sich gezielt filtern.`}
      />
      <FilterBar action="/admin/deals">
        <FilterSearch label="Titel, Händler, Artikelnummer oder ID" value={filters.q} placeholder="z. B. Notebook" />
        <FilterSelect name="filter" label="Ansicht" value={filters.filter} options={FILTER_OPTIONS} />
        {filters.merchant ? <input type="hidden" name="merchant" value={filters.merchant} /> : null}
      </FilterBar>
      {filters.merchant ? (
        <p className="text-sm text-ink-600">
          Nur Deals eines Händlers. <Link href={withQuery('/admin/deals', { q: filters.q, filter: filters.filter })} className="font-semibold text-brand-700 hover:underline">Filter entfernen</Link>
        </p>
      ) : null}
      {result.items.length ? (
        <div className={table.wrapper}>
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={table.th}>Angebot</th>
                <th className={table.th}>Status</th>
                <th className={table.th}>Preis</th>
                <th className={table.th}>Händler</th>
                <th className={table.th}>Geändert</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((d) => (
                <tr key={d.id} className={table.row}>
                  <td className={table.tdMain}>
                    <div className="flex items-center gap-3">
                      {d.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- Bild ist serverseitig verkleinert (WebP)
                        <img src={d.imageUrl} alt="" className="size-12 shrink-0 rounded-lg bg-canvas object-contain" />
                      ) : (
                        <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-canvas text-ink-400">
                          <ImageOff className="size-5" aria-hidden="true" />
                        </span>
                      )}
                      <Link href={`/admin/deals/${d.id}`} className="line-clamp-2 font-semibold text-ink-900 hover:text-brand-700 hover:underline">
                        {d.title}
                      </Link>
                    </div>
                  </td>
                  <td className={table.td} data-label="Status">
                    <span className="flex flex-wrap gap-1.5">
                      <DealStatusBadge status={d.status} />
                      {d.openReports ? <Badge tone="danger">{d.openReports} Meldung(en)</Badge> : null}
                      {d.linkStatus === 'BROKEN' ? <Badge tone="danger">Link defekt</Badge> : null}
                    </span>
                  </td>
                  <td className={table.td} data-label="Preis">
                    {formatPriceCents(d.priceCents)}
                    {d.discountPercent !== null ? <span className="ml-1.5 font-semibold text-accent-700">−{d.discountPercent} %</span> : null}
                  </td>
                  <td className={table.td} data-label="Händler">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Link href={`/admin/nutzer/${d.merchant.id}`} className="font-medium text-brand-700 hover:underline">{d.merchant.name}</Link>
                      {d.merchantStatus !== 'ACTIVE' ? <UserStatusBadge status={d.merchantStatus} /> : null}
                    </span>
                  </td>
                  <td className={table.td} data-label="Geändert">{formatDateTime(d.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>Keine Deals mit diesen Filtern.</EmptyState>
      )}
      <Pagination page={result.page} totalPages={totalPages(result.total, result.pageSize)} hrefFor={(p) => withQuery('/admin/deals', { ...filters, page: p })} />
    </div>
  );
}
