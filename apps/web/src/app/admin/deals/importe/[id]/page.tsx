import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { Alert, Skeleton } from '@marktat/ui';
import { DEAL_IMPORT_STATUS_LABELS, formatDateTime, type AdminDealImportSummary, type DealImportView } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { ENTITY_ID } from '@/lib/admin';
import { importCountsText, IMPORT_SOURCE_LABELS } from '@/lib/deal-imports';
import { DealImportRows } from '@/components/deals/deal-import-rows';
import { PageTitle } from '@/components/admin/admin-ui';

export const metadata: Metadata = { title: 'Import' };

export default function AdminDealImportPage({ params }: PageProps<'/admin/deals/importe/[id]'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <ImportDetail params={params} />
    </Suspense>
  );
}

async function ImportDetail({ params }: Pick<PageProps<'/admin/deals/importe/[id]'>, 'params'>) {
  const { id } = await params;
  if (!ENTITY_ID.test(id)) notFound();
  const { token } = await requireStaff(`/admin/deals/importe/${id}`);
  let view: DealImportView & Pick<AdminDealImportSummary, 'merchant'>;
  try {
    view = await api<DealImportView & Pick<AdminDealImportSummary, 'merchant'>>(`/admin/deal-imports/${id}`, { token, cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  return (
    <div className="space-y-5">
      <Link href="/admin/deals/importe" className="text-sm font-semibold text-brand-700 hover:underline">← Importfehler</Link>
      <PageTitle
        title={`${IMPORT_SOURCE_LABELS[view.source]}: ${view.fileName ?? '–'}`}
        description={
          <>
            <Link href={`/admin/nutzer/${view.merchant.id}`} className="text-brand-700 hover:underline">{view.merchant.name}</Link> · {formatDateTime(view.createdAt)} ·{' '}
            {DEAL_IMPORT_STATUS_LABELS[view.status]} · {importCountsText(view)}
          </>
        }
      />
      {view.error ? <Alert tone={view.status === 'FAILED' ? 'danger' : 'info'}>{view.error}</Alert> : null}
      <DealImportRows rows={view.rows} dealHref={(dealId) => `/admin/deals/${dealId}`} />
    </div>
  );
}
