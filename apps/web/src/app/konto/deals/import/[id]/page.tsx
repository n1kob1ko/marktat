import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { Download } from 'lucide-react';
import { Alert, buttonClasses, Card, Skeleton } from '@marktat/ui';
import { DEAL_IMPORT_FIELDS, DEAL_IMPORT_STATUS_LABELS, formatDateTime, type DealerEligibility, type DealImportView } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { importCountsText } from '@/lib/deal-imports';
import { FlashMessage } from '@/components/flash-message';
import { DealImportRows } from '@/components/deals/deal-import-rows';
import { CancelImportButton, CommitImportForm, MappingForm } from '../forms';

export const metadata: Metadata = { title: 'Import', robots: { index: false } };

export default function DealImportDetailPage({ params, searchParams }: PageProps<'/konto/deals/import/[id]'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <ImportDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ImportDetail({ params, searchParams }: Pick<PageProps<'/konto/deals/import/[id]'>, 'params' | 'searchParams'>) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { token } = await requireUser(`/konto/deals/import/${id}`);
  let view: DealImportView;
  let eligibility: DealerEligibility;
  try {
    [view, eligibility] = await Promise.all([
      api<DealImportView>(`/me/deal-imports/${id}`, { token, cache: 'no-store' }),
      api<DealerEligibility>('/me/dealer-eligibility', { token, cache: 'no-store' }),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const hinweis = typeof query.hinweis === 'string' ? query.hinweis : undefined;
  const isPreview = view.status === 'PREVIEW';
  // Probeabruf eines Feeds: Zuordnung wird am Feed gespeichert
  const feedPreview = view.source === 'FEED' && view.status === 'CANCELLED' && view.feedId ? view.feedId : null;
  const hasProblems = view.rows.some((r) => r.action === 'ERROR' || r.action === 'SKIP' || r.warnings.length);
  const title = view.source === 'FEED' ? `Feed: ${view.fileName ?? 'Produktfeed'}` : (view.fileName ?? 'CSV-Datei');

  return (
    <div className="space-y-6">
      <FlashMessage hinweis={hinweis} />
      <div>
        <Link href={view.source === 'FEED' ? '/konto/deals/feeds' : '/konto/deals/import'} className="text-sm font-semibold text-brand-700 hover:underline">
          ← {view.source === 'FEED' ? 'Produktfeeds' : 'Importe'}
        </Link>
        <h2 className="mt-2 font-sans text-xl font-semibold tracking-normal break-words">{title}</h2>
        <p className="mt-1 text-sm text-ink-600">
          {formatDateTime(view.createdAt)} · {feedPreview ? 'Probeabruf – nichts übernommen' : DEAL_IMPORT_STATUS_LABELS[view.status]}
          {view.expiresAt && isPreview ? ` · Vorschau gültig bis ${formatDateTime(view.expiresAt)}` : ''}
        </p>
        <p className="mt-1 text-sm font-semibold text-ink-800" data-testid="deal-import-counts">{importCountsText(view)}</p>
      </div>

      {view.status === 'FAILED' && view.error ? <Alert tone="danger" title="Der Import ist fehlgeschlagen">{view.error}</Alert> : null}
      {isPreview ? (
        <Alert tone="info" title="Vorschau">
          Noch wurde nichts übernommen. Prüfe die Zuordnung und die Zeilen unten; fehlerhafte Zeilen werden beim Übernehmen übersprungen.
        </Alert>
      ) : null}

      {(isPreview || feedPreview) && view.headers.length ? (
        <Card className="space-y-4 p-5">
          <h3 className="font-sans text-base font-semibold tracking-normal">Spalten zuordnen</h3>
          {view.missingFields.length ? (
            <Alert tone="warning">Noch nicht zugeordnet: {view.missingFields.map((f) => DEAL_IMPORT_FIELDS[f].label).join(', ')}</Alert>
          ) : (
            <p className="text-sm text-ink-600">Alle Pflichtspalten sind zugeordnet. Bei Bedarf kannst du die Zuordnung ändern.</p>
          )}
          <MappingForm id={view.id} feedId={feedPreview} headers={view.headers} mapping={view.mapping} />
        </Card>
      ) : null}

      <section className="space-y-3" aria-labelledby="zeilen">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="zeilen" className="font-sans text-base font-semibold tracking-normal">{isPreview || feedPreview ? 'Vorschau je Zeile' : 'Ergebnis je Zeile'}</h3>
          {hasProblems ? (
            <a href={`/api/deals/importe/${view.id}/fehler`} className={buttonClasses({ variant: 'outline', size: 'sm' })} download>
              <Download className="size-4" aria-hidden="true" /> Fehlerliste (CSV)
            </a>
          ) : null}
        </div>
        <DealImportRows rows={view.rows} dealHref={(dealId) => `/konto/deals/${dealId}`} />
      </section>

      {isPreview && !view.missingFields.length ? (
        <Card className="space-y-4 p-5">
          <h3 className="font-sans text-base font-semibold tracking-normal">Übernehmen</h3>
          {eligibility.blocked ? <Alert tone="danger">Dein Konto ist für Deals gesperrt.</Alert> : null}
          <CommitImportForm id={view.id} hasReferencePrices={view.hasReferencePrices} canPublish={eligibility.eligible} />
          <CancelImportButton id={view.id} />
        </Card>
      ) : isPreview ? (
        <CancelImportButton id={view.id} />
      ) : null}
    </div>
  );
}
