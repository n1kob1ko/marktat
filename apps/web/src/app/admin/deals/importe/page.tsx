import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Skeleton } from '@marktat/ui';
import { DEAL_IMPORT_STATUS_LABELS, formatDateTime, type AdminDealImportSummary } from '@marktat/shared';
import { api } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { importCountsText, IMPORT_SOURCE_LABELS } from '@/lib/deal-imports';
import { EmptyState, PageTitle, table } from '@/components/admin/admin-ui';

export const metadata: Metadata = { title: 'Importfehler' };

export default function AdminDealImportsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Imports />
    </Suspense>
  );
}

async function Imports() {
  const { token } = await requireStaff('/admin/deals/importe');
  const imports = await api<AdminDealImportSummary[]>('/admin/deal-imports', { token, cache: 'no-store' });
  return (
    <div className="space-y-5">
      <Link href="/admin/deals" className="text-sm font-semibold text-brand-700 hover:underline">← Deals</Link>
      <PageTitle title="Importfehler" description="Fehlgeschlagene Importe und Importe mit fehlerhaften Zeilen der letzten 30 Tage (CSV und Produktfeeds)." />
      {imports.length === 0 ? (
        <EmptyState>Keine Importfehler in den letzten 30 Tagen.</EmptyState>
      ) : (
        <div className={table.wrapper}>
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={table.th}>Import</th>
                <th className={table.th}>Händler</th>
                <th className={table.th}>Status</th>
                <th className={table.th}>Ergebnis</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((item) => (
                <tr key={item.id} className={table.row}>
                  <td className={table.tdMain}>
                    <Link href={`/admin/deals/importe/${item.id}`} className="font-semibold text-ink-900 hover:text-brand-700 hover:underline">
                      {IMPORT_SOURCE_LABELS[item.source]}: {item.fileName ?? '–'}
                    </Link>
                    <p className="text-xs text-ink-500">{formatDateTime(item.createdAt)}</p>
                  </td>
                  <td className={table.td} data-label="Händler">
                    <Link href={`/admin/nutzer/${item.merchant.id}`} className="text-brand-700 hover:underline">{item.merchant.name}</Link>
                  </td>
                  <td className={table.td} data-label="Status">{DEAL_IMPORT_STATUS_LABELS[item.status]}</td>
                  <td className={table.td} data-label="Ergebnis">{item.error ?? importCountsText(item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
