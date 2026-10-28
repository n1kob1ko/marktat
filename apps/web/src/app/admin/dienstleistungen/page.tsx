import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Badge, Skeleton } from '@marktat/ui';
import { ADMIN_SERVICE_FILTER_LABELS, ADMIN_SERVICE_FILTERS, formatDateTime, type AdminServiceProfileSummary, type Paginated } from '@marktat/shared';
import { api } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { pick, totalPages, withQuery } from '@/lib/admin';
import { Pagination } from '@/components/pagination';
import { ServiceStatusBadge } from '@/components/services/service-status-badge';
import { EmptyState, FilterBar, FilterSearch, FilterSelect, PageTitle, table, UserStatusBadge } from '@/components/admin/admin-ui';

export const metadata: Metadata = { title: 'Dienstleistungen' };

const FILTERS = ['q', 'filter'] as const;
const FILTER_OPTIONS = ADMIN_SERVICE_FILTERS.map((value) => ({ value: value === 'review' ? '' : value, label: ADMIN_SERVICE_FILTER_LABELS[value] }));

export default function AdminServicesPage({ searchParams }: PageProps<'/admin/dienstleistungen'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Services searchParams={searchParams} />
    </Suspense>
  );
}

async function Services({ searchParams }: Pick<PageProps<'/admin/dienstleistungen'>, 'searchParams'>) {
  const [{ token }, params] = await Promise.all([requireStaff('/admin/dienstleistungen'), searchParams]);
  const filters = pick(params, FILTERS);
  const page = Number(pick(params, ['page']).page ?? 1) || 1;
  const result = await api<Paginated<AdminServiceProfileSummary>>(withQuery('/admin/services', { ...filters, page }), { token, cache: 'no-store' });

  return (
    <div className="space-y-5">
      <PageTitle
        title="Dienstleistungen"
        description={`${result.total.toLocaleString('de-AT')} Anbieterprofil(e). Standardmäßig: in Prüfung, gemeldet oder mit offenen Qualifikationen.`}
      />
      <FilterBar action="/admin/dienstleistungen">
        <FilterSearch label="Überschrift, Name oder ID" value={filters.q} placeholder="z. B. Elektriker" />
        <FilterSelect name="filter" label="Ansicht" value={filters.filter} options={FILTER_OPTIONS} />
      </FilterBar>
      {result.items.length ? (
        <div className={table.wrapper}>
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={table.th}>Profil</th>
                <th className={table.th}>Status</th>
                <th className={table.th}>Anbieter:in</th>
                <th className={table.th}>Kategorien</th>
                <th className={table.th}>Geändert</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((p) => (
                <tr key={p.id} className={table.row}>
                  <td className={table.tdMain}>
                    <Link href={`/admin/dienstleistungen/${p.id}`} className="line-clamp-2 font-semibold text-ink-900 hover:text-brand-700 hover:underline">
                      {p.headline}
                    </Link>
                  </td>
                  <td className={table.td} data-label="Status">
                    <span className="flex flex-wrap gap-1.5">
                      <ServiceStatusBadge status={p.status} />
                      {p.openReports ? <Badge tone="danger">{p.openReports} Meldung(en)</Badge> : null}
                      {p.pendingQualifications ? <Badge tone="warning">{p.pendingQualifications} Qualifikation(en) offen</Badge> : null}
                      {p.hiddenPortfolioItems ? <Badge tone="neutral">{p.hiddenPortfolioItems} ausgeblendet</Badge> : null}
                    </span>
                  </td>
                  <td className={table.td} data-label="Anbieter:in">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Link href={`/admin/nutzer/${p.provider.id}`} className="font-medium text-brand-700 hover:underline">{p.provider.displayName}</Link>
                      <span className="text-ink-500">{p.provider.business ? 'gewerblich' : 'privat'}</span>
                      {p.provider.status !== 'ACTIVE' ? <UserStatusBadge status={p.provider.status} /> : null}
                    </span>
                  </td>
                  <td className={table.td} data-label="Kategorien">{p.categories.join(', ')}</td>
                  <td className={table.td} data-label="Geändert">{formatDateTime(p.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>Keine Anbieterprofile mit diesen Filtern.</EmptyState>
      )}
      <Pagination page={result.page} totalPages={totalPages(result.total, result.pageSize)} hrefFor={(p) => withQuery('/admin/dienstleistungen', { ...filters, page: p })} />
    </div>
  );
}
