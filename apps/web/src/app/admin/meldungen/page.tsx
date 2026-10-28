import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Badge, Skeleton } from '@marktat/ui';
import {
  formatDateTime,
  REPORT_PRIORITIES,
  REPORT_PRIORITY_LABELS,
  REPORT_REASON_LABELS,
  REPORT_REASONS,
  REPORT_STATUS_LABELS,
  REPORT_STATUSES,
  REPORT_TARGET_LABELS,
  REPORT_TARGETS,
  type AdminReportSummary,
  type Paginated,
} from '@marktat/shared';
import { api } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { pick, totalPages, withQuery } from '@/lib/admin';
import { Pagination } from '@/components/pagination';
import { EmptyState, FilterBar, FilterSelect, PageTitle, PersonLink, PriorityBadge, ReportStatusBadge, table } from '@/components/admin/admin-ui';

export const metadata: Metadata = { title: 'Meldungen' };

const FILTERS = ['status', 'target', 'reason', 'priority', 'assignee'] as const;

export default function ReportsPage({ searchParams }: PageProps<'/admin/meldungen'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Reports searchParams={searchParams} />
    </Suspense>
  );
}

async function Reports({ searchParams }: Pick<PageProps<'/admin/meldungen'>, 'searchParams'>) {
  const [{ token }, params] = await Promise.all([requireStaff('/admin/meldungen'), searchParams]);
  const filters = pick(params, FILTERS);
  const page = Number(pick(params, ['page']).page ?? 1) || 1;
  const result = await api<Paginated<AdminReportSummary>>(withQuery('/admin/reports', { ...filters, page }), { token, cache: 'no-store' });

  return (
    <div className="space-y-5">
      <PageTitle title="Meldungen" description={`${result.total.toLocaleString('de-AT')} Meldung(en). Dringende und ältere zuerst.`} />
      <FilterBar action="/admin/meldungen">
        <FilterSelect
          name="status"
          label="Status"
          value={filters.status}
          options={[{ value: '', label: 'Offen und in Bearbeitung' }, ...REPORT_STATUSES.map((s) => ({ value: s, label: REPORT_STATUS_LABELS[s] }))]}
        />
        <FilterSelect name="target" label="Art" value={filters.target} options={[{ value: '', label: 'Alle' }, ...REPORT_TARGETS.map((t) => ({ value: t, label: REPORT_TARGET_LABELS[t] }))]} />
        <FilterSelect name="reason" label="Grund" value={filters.reason} options={[{ value: '', label: 'Alle Gründe' }, ...REPORT_REASONS.map((r) => ({ value: r, label: REPORT_REASON_LABELS[r] }))]} />
        <FilterSelect name="priority" label="Priorität" value={filters.priority} options={[{ value: '', label: 'Alle' }, ...REPORT_PRIORITIES.map((p) => ({ value: p, label: REPORT_PRIORITY_LABELS[p] }))]} />
        <FilterSelect
          name="assignee"
          label="Zuständig"
          value={filters.assignee}
          options={[
            { value: '', label: 'Alle' },
            { value: 'me', label: 'Ich' },
            { value: 'none', label: 'Niemand' },
          ]}
        />
      </FilterBar>

      {result.items.length ? (
        <div className={table.wrapper}>
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={table.th}>Meldung</th>
                <th className={table.th}>Status</th>
                <th className={table.th}>Gemeldet</th>
                <th className={table.th}>Zuständig</th>
                <th className={table.th}>Eingang</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((r) => (
                <tr key={r.id} className={table.row}>
                  <td className={table.tdMain}>
                    <Link href={`/admin/meldungen/${r.id}`} className="font-semibold text-ink-900 hover:text-brand-700 hover:underline">
                      {REPORT_REASON_LABELS[r.reason]}
                      <span className="font-normal text-ink-500"> · {REPORT_TARGET_LABELS[r.targetType]}</span>
                    </Link>
                    <p className="mt-0.5 line-clamp-2 max-w-md text-ink-600">{r.listing ? r.listing.title : r.deal ? `Deal: ${r.deal.title}` : r.serviceProfile ? `Anbieterprofil: ${r.serviceProfile.title}` : r.project ? `Projektauftrag: ${r.project.title}` : r.details}</p>
                  </td>
                  <td className={table.td} data-label="Status">
                    <span className="flex flex-wrap gap-1.5">
                      <ReportStatusBadge status={r.status} />
                      {r.priority !== 'NORMAL' ? <PriorityBadge priority={r.priority} /> : null}
                      {r.relatedOpen ? <Badge tone="neutral">+{r.relatedOpen} weitere</Badge> : null}
                    </span>
                  </td>
                  <td className={table.td} data-label="Gemeldet"><PersonLink person={r.reported} fallback="Gelöschtes Konto" /></td>
                  <td className={table.td} data-label="Zuständig"><PersonLink person={r.assignee} fallback="Niemand" /></td>
                  <td className={table.td} data-label="Eingang">{formatDateTime(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>Keine Meldungen mit diesen Filtern.</EmptyState>
      )}
      <Pagination page={result.page} totalPages={totalPages(result.total, result.pageSize)} hrefFor={(p) => withQuery('/admin/meldungen', { ...filters, page: p })} />
    </div>
  );
}
