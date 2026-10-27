import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { Badge, Skeleton } from '@marktat/ui';
import { formatDate, USER_ROLE_LABELS, USER_STATUS_LABELS, USER_STATUSES, type AdminUserSummary, type Paginated } from '@marktat/shared';
import { api } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { pick, totalPages, withQuery } from '@/lib/admin';
import { Pagination } from '@/components/pagination';
import { EmptyState, FilterBar, FilterSearch, FilterSelect, PageTitle, RoleBadge, table, UserStatusBadge } from '@/components/admin/admin-ui';

export const metadata: Metadata = { title: 'Konten' };

const FILTERS = ['q', 'status', 'role'] as const;

export default function AdminUsersPage({ searchParams }: PageProps<'/admin/nutzer'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Users searchParams={searchParams} />
    </Suspense>
  );
}

async function Users({ searchParams }: Pick<PageProps<'/admin/nutzer'>, 'searchParams'>) {
  const [{ user, token }, params] = await Promise.all([requireStaff('/admin/nutzer'), searchParams]);
  // Kontensuche nur für Administratoren; Moderation erreicht Konten über Meldungen und Inserate
  if (user.role !== 'ADMIN') notFound();
  const filters = pick(params, FILTERS);
  const page = Number(pick(params, ['page']).page ?? 1) || 1;
  const result = await api<Paginated<AdminUserSummary>>(withQuery('/admin/users', { ...filters, page }), { token, cache: 'no-store' });

  return (
    <div className="space-y-5">
      <PageTitle title="Konten" description={`${result.total.toLocaleString('de-AT')} Konto/Konten`} />
      <FilterBar action="/admin/nutzer">
        <FilterSearch label="Name, E-Mail oder ID" value={filters.q} />
        <FilterSelect name="status" label="Status" value={filters.status} options={[{ value: '', label: 'Alle' }, ...USER_STATUSES.map((s) => ({ value: s, label: USER_STATUS_LABELS[s] }))]} />
        <FilterSelect
          name="role"
          label="Rolle"
          value={filters.role}
          options={[{ value: '', label: 'Alle' }, ...(['USER', 'MODERATOR', 'ADMIN'] as const).map((r) => ({ value: r, label: USER_ROLE_LABELS[r] }))]}
        />
      </FilterBar>
      {result.items.length ? (
        <div className={table.wrapper}>
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={table.th}>Konto</th>
                <th className={table.th}>Status</th>
                <th className={table.th}>Inserate</th>
                <th className={table.th}>Meldungen</th>
                <th className={table.th}>Registriert</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((u) => (
                <tr key={u.id} className={table.row}>
                  <td className={table.tdMain}>
                    <Link href={`/admin/nutzer/${u.id}`} className="font-semibold text-ink-900 hover:text-brand-700 hover:underline">{u.displayName}</Link>
                    {u.email ? <span className="block break-all text-ink-500">{u.email}</span> : null}
                  </td>
                  <td className={table.td} data-label="Status">
                    <span className="flex flex-wrap gap-1.5">
                      <UserStatusBadge status={u.status} />
                      <RoleBadge role={u.role} />
                      {u.accountType === 'BUSINESS' ? <Badge tone="brand">Gewerblich</Badge> : null}
                    </span>
                  </td>
                  <td className={table.td} data-label="Inserate">{u.activeListings} aktiv</td>
                  <td className={table.td} data-label="Meldungen">{u.openReports ? <Badge tone="danger">{u.openReports} offen</Badge> : '–'}</td>
                  <td className={table.td} data-label="Registriert">{formatDate(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>Keine Konten mit diesen Filtern.</EmptyState>
      )}
      <Pagination page={result.page} totalPages={totalPages(result.total, result.pageSize)} hrefFor={(p) => withQuery('/admin/nutzer', { ...filters, page: p })} />
    </div>
  );
}
