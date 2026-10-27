import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { Skeleton } from '@marktat/ui';
import { formatDateTime, type AuditEntry, type Paginated } from '@marktat/shared';
import { api } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { pick, totalPages, withQuery } from '@/lib/admin';
import { Pagination } from '@/components/pagination';
import { EmptyState, FilterBar, FilterSearch, FilterSelect, PageTitle, PersonLink, table } from '@/components/admin/admin-ui';

export const metadata: Metadata = { title: 'Protokoll' };

const FILTERS = ['action', 'actorId', 'entityId'] as const;
const ACTION_OPTIONS = [
  { value: '', label: 'Alle Ereignisse' },
  { value: 'moderation.', label: 'Moderationsentscheidungen' },
  { value: 'report.', label: 'Meldungen bearbeitet' },
  { value: 'report.messages_viewed', label: 'Einsicht in Nachrichten' },
  { value: 'listing.reported', label: 'Inserate gemeldet' },
  { value: 'appeal.', label: 'Einsprüche' },
  { value: 'admin.', label: 'Rollen, Einschränkungen, Preise' },
  { value: 'admin.product_updated', label: 'Preise und Leistungen geändert' },
  { value: 'admin.billing_mode_changed', label: 'Betriebsmodus geändert' },
  { value: 'billing.', label: 'Buchungen und Zahlungen' },
  { value: 'privacy.', label: 'Datenexport und Löschung' },
  { value: 'user.', label: 'Konten (Anlage, Profil, Blockieren)' },
  { value: 'listing.', label: 'Inserate (Anlage, Status, Bilder)' },
  { value: 'retention.', label: 'Aufbewahrung' },
];

export default function AuditPage({ searchParams }: PageProps<'/admin/protokoll'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Audit searchParams={searchParams} />
    </Suspense>
  );
}

async function Audit({ searchParams }: Pick<PageProps<'/admin/protokoll'>, 'searchParams'>) {
  const [{ user, token }, params] = await Promise.all([requireStaff('/admin/protokoll'), searchParams]);
  if (user.role !== 'ADMIN') notFound();
  const filters = pick(params, FILTERS);
  const page = Number(pick(params, ['page']).page ?? 1) || 1;
  const result = await api<Paginated<AuditEntry>>(withQuery('/admin/audit', { ...filters, page }), { token, cache: 'no-store' });

  return (
    <div className="space-y-5">
      <PageTitle title="Protokoll" description="Sicherheits- und Moderationsereignisse. IP-Adressen werden nur gekürzt gespeichert, Inhalte von Nachrichten nie." />
      <FilterBar action="/admin/protokoll">
        <FilterSelect name="action" label="Ereignis" value={filters.action} options={ACTION_OPTIONS} />
        <FilterSearch name="entityId" label="Objekt-ID" value={filters.entityId} placeholder="Inserat, Meldung, Konto …" />
        {filters.actorId ? <input type="hidden" name="actorId" value={filters.actorId} /> : null}
      </FilterBar>
      {result.items.length ? (
        <div className={table.wrapper}>
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={table.th}>Ereignis</th>
                <th className={table.th}>Von</th>
                <th className={table.th}>Objekt</th>
                <th className={table.th}>Details</th>
                <th className={table.th}>Zeit</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((e) => (
                <tr key={e.id} className={table.row}>
                  <td className={table.tdMain}><code className="text-xs font-semibold break-all text-ink-900">{e.action}</code></td>
                  <td className={table.td} data-label="Von">
                    <span>
                      <PersonLink person={e.actor} fallback="System" />
                      {e.ipPrefix ? <span className="block text-xs text-ink-500">{e.ipPrefix}</span> : null}
                    </span>
                  </td>
                  <td className={table.td} data-label="Objekt">
                    {e.entityId ? <span className="text-xs break-all text-ink-600">{e.entityType} {e.entityId}</span> : '–'}
                  </td>
                  <td className={table.td} data-label="Details">
                    {e.metadata ? <pre className="max-h-32 max-w-xs overflow-auto rounded-lg bg-canvas p-2 text-xs whitespace-pre-wrap text-ink-700">{JSON.stringify(e.metadata, null, 1)}</pre> : '–'}
                  </td>
                  <td className={table.td} data-label="Zeit">{formatDateTime(e.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>Keine Einträge mit diesen Filtern.</EmptyState>
      )}
      <Pagination page={result.page} totalPages={totalPages(result.total, result.pageSize)} hrefFor={(p) => withQuery('/admin/protokoll', { ...filters, page: p })} />
    </div>
  );
}
