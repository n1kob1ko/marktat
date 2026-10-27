import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Skeleton } from '@marktat/ui';
import { APPEAL_STATUS_LABELS, APPEAL_STATUSES, formatDateTime, MODERATION_ACTION_LABELS, type AdminAppealItem, type Paginated } from '@marktat/shared';
import { api } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { pick, totalPages, withQuery } from '@/lib/admin';
import { Pagination } from '@/components/pagination';
import { AppealStatusBadge, EmptyState, FilterBar, FilterSelect, PageTitle, PersonLink, table } from '@/components/admin/admin-ui';

export const metadata: Metadata = { title: 'Einsprüche' };

export default function AppealsPage({ searchParams }: PageProps<'/admin/einsprueche'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Appeals searchParams={searchParams} />
    </Suspense>
  );
}

async function Appeals({ searchParams }: Pick<PageProps<'/admin/einsprueche'>, 'searchParams'>) {
  const [{ token }, params] = await Promise.all([requireStaff('/admin/einsprueche'), searchParams]);
  const filters = pick(params, ['status']);
  const page = Number(pick(params, ['page']).page ?? 1) || 1;
  const result = await api<Paginated<AdminAppealItem>>(withQuery('/admin/appeals', { ...filters, page }), { token, cache: 'no-store' });

  return (
    <div className="space-y-5">
      <PageTitle title="Einsprüche" description="Interne Beschwerden gegen Entscheidungen (Art. 20 DSA). Älteste zuerst; nach Möglichkeit prüft jemand anderer als die ursprünglich entscheidende Person." />
      <FilterBar action="/admin/einsprueche">
        <FilterSelect name="status" label="Status" value={filters.status ?? 'OPEN'} options={APPEAL_STATUSES.map((s) => ({ value: s, label: APPEAL_STATUS_LABELS[s] }))} />
      </FilterBar>
      {result.items.length ? (
        <div className={table.wrapper}>
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={table.th}>Einspruch gegen</th>
                <th className={table.th}>Status</th>
                <th className={table.th}>Von</th>
                <th className={table.th}>Eingang</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((a) => (
                <tr key={a.id} className={table.row}>
                  <td className={table.tdMain}>
                    <Link href={`/admin/einsprueche/${a.id}`} className="font-semibold text-ink-900 hover:text-brand-700 hover:underline">
                      {MODERATION_ACTION_LABELS[a.decision.action]}
                    </Link>
                    {a.decision.listing ? <span className="block truncate text-ink-500">{a.decision.listing.title}</span> : null}
                  </td>
                  <td className={table.td} data-label="Status"><AppealStatusBadge status={a.status} /></td>
                  <td className={table.td} data-label="Von"><PersonLink person={a.user} /></td>
                  <td className={table.td} data-label="Eingang">{formatDateTime(a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>Keine Einsprüche mit diesem Status.</EmptyState>
      )}
      <Pagination page={result.page} totalPages={totalPages(result.total, result.pageSize)} hrefFor={(p) => withQuery('/admin/einsprueche', { ...filters, page: p })} />
    </div>
  );
}
