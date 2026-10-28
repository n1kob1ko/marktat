import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Badge, Skeleton } from '@marktat/ui';
import { ADMIN_PROJECT_FILTER_LABELS, ADMIN_PROJECT_FILTERS, formatDateTime, type AdminProjectSummary, type Paginated } from '@marktat/shared';
import { api } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { pick, totalPages, withQuery } from '@/lib/admin';
import { Pagination } from '@/components/pagination';
import { ProjectStatusBadge } from '@/components/services/project-status-badge';
import { EmptyState, FilterBar, FilterSearch, FilterSelect, PageTitle, table, UserStatusBadge } from '@/components/admin/admin-ui';

export const metadata: Metadata = { title: 'Projektaufträge' };

const FILTERS = ['q', 'filter'] as const;
const FILTER_OPTIONS = ADMIN_PROJECT_FILTERS.map((value) => ({ value: value === 'review' ? '' : value, label: ADMIN_PROJECT_FILTER_LABELS[value] }));

export default function AdminProjectsPage({ searchParams }: PageProps<'/admin/dienstleistungen/projekte'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Projects searchParams={searchParams} />
    </Suspense>
  );
}

async function Projects({ searchParams }: Pick<PageProps<'/admin/dienstleistungen/projekte'>, 'searchParams'>) {
  const [{ token }, params] = await Promise.all([requireStaff('/admin/dienstleistungen/projekte'), searchParams]);
  const filters = pick(params, FILTERS);
  const page = Number(pick(params, ['page']).page ?? 1) || 1;
  const result = await api<Paginated<AdminProjectSummary>>(withQuery('/admin/projects', { ...filters, page }), { token, cache: 'no-store' });

  return (
    <div className="space-y-5">
      <PageTitle title="Projektaufträge" description={`${result.total.toLocaleString('de-AT')} Auftrag/Aufträge. Standardmäßig: in Prüfung oder gemeldet.`} />
      <p className="text-sm">
        <Link href="/admin/dienstleistungen" className="font-semibold text-brand-700 hover:underline">Zu den Anbieterprofilen</Link>
      </p>
      <FilterBar action="/admin/dienstleistungen/projekte">
        <FilterSearch label="Titel, Name oder ID" value={filters.q} placeholder="z. B. Website" />
        <FilterSelect name="filter" label="Ansicht" value={filters.filter} options={FILTER_OPTIONS} />
      </FilterBar>
      {result.items.length ? (
        <div className={table.wrapper}>
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={table.th}>Auftrag</th>
                <th className={table.th}>Status</th>
                <th className={table.th}>Auftraggeber:in</th>
                <th className={table.th}>Kategorie</th>
                <th className={table.th}>Anfragen</th>
                <th className={table.th}>Geändert</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((p) => (
                <tr key={p.id} className={table.row}>
                  <td className={table.tdMain}>
                    <Link href={`/admin/dienstleistungen/projekte/${p.id}`} className="line-clamp-2 font-semibold text-ink-900 hover:text-brand-700 hover:underline">
                      {p.title}
                    </Link>
                  </td>
                  <td className={table.td} data-label="Status">
                    <span className="flex flex-wrap gap-1.5">
                      <ProjectStatusBadge status={p.status} expired={p.expired} />
                      {p.openReports ? <Badge tone="danger">{p.openReports} Meldung(en)</Badge> : null}
                    </span>
                  </td>
                  <td className={table.td} data-label="Auftraggeber:in">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Link href={`/admin/nutzer/${p.client.id}`} className="font-medium text-brand-700 hover:underline">{p.client.displayName}</Link>
                      <span className="text-ink-500">{p.client.business ? 'gewerblich' : 'privat'}</span>
                      {p.client.status !== 'ACTIVE' ? <UserStatusBadge status={p.client.status} /> : null}
                    </span>
                  </td>
                  <td className={table.td} data-label="Kategorie">{p.category}</td>
                  <td className={table.td} data-label="Anfragen">{p.contactCount}</td>
                  <td className={table.td} data-label="Geändert">{formatDateTime(p.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>Keine Projektaufträge mit diesen Filtern.</EmptyState>
      )}
      <Pagination page={result.page} totalPages={totalPages(result.total, result.pageSize)} hrefFor={(p) => withQuery('/admin/dienstleistungen/projekte', { ...filters, page: p })} />
    </div>
  );
}
