import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Badge, type BadgeTone, Field, Input, Skeleton } from '@marktat/ui';
import { DEAL_FEED_FORMAT_LABELS, DEAL_FEED_STATUS_LABELS, DEAL_FEED_STATUSES, formatDateTime, type DealFeedStatus, type DealFeedView } from '@marktat/shared';
import { api } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { pick, withQuery } from '@/lib/admin';
import { importCountsText } from '@/lib/deal-imports';
import { SubmitButton } from '@/components/submit-button';
import { EmptyState, FilterBar, FilterSelect, PageTitle } from '@/components/admin/admin-ui';
import { ActionForm } from '@/components/admin/forms';
import { reviewDealFeedAction } from '../../actions';

export const metadata: Metadata = { title: 'Produktfeeds' };

const STATUS_TONES: Record<DealFeedStatus, BadgeTone> = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', PAUSED: 'neutral', FAILING: 'danger' };
const STATUS_OPTIONS = [{ value: '', label: 'Alle' }, ...DEAL_FEED_STATUSES.map((s) => ({ value: s, label: DEAL_FEED_STATUS_LABELS[s] }))];

export default function AdminDealFeedsPage({ searchParams }: PageProps<'/admin/deals/feeds'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Feeds searchParams={searchParams} />
    </Suspense>
  );
}

async function Feeds({ searchParams }: Pick<PageProps<'/admin/deals/feeds'>, 'searchParams'>) {
  const [{ token }, params] = await Promise.all([requireStaff('/admin/deals/feeds'), searchParams]);
  const filters = pick(params, ['status'] as const);
  const feeds = await api<DealFeedView[]>(withQuery('/admin/deal-feeds', filters), { token, cache: 'no-store' });

  return (
    <div className="space-y-5">
      <Link href="/admin/deals" className="text-sm font-semibold text-brand-700 hover:underline">← Deals</Link>
      <PageTitle
        title="Produktfeeds"
        description="Feeds werden erst nach der Freigabe abgerufen. Prüfe, ob die Adresse zum Händler gehört (eigene Domain oder benannter Feed-Dienstleister) und ob die Herkunftsangabe plausibel ist. Feeds, die Daten anderer Plattformen enthalten, ablehnen."
      />
      <FilterBar action="/admin/deals/feeds">
        <FilterSelect name="status" label="Status" value={filters.status} options={STATUS_OPTIONS} />
      </FilterBar>
      {feeds.length === 0 ? (
        <EmptyState>Keine Feeds in dieser Ansicht.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {feeds.map((feed) => (
            <li key={feed.id} className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink-950">{feed.name}</span>
                <Badge tone={STATUS_TONES[feed.status]}>{DEAL_FEED_STATUS_LABELS[feed.status]}</Badge>
                <Link href={`/admin/nutzer/${feed.merchant.id}`} className="text-brand-700 hover:underline">{feed.merchant.name}</Link>
              </div>
              <p className="break-all font-mono text-xs text-ink-700">{feed.url}</p>
              <p className="text-ink-700"><span className="text-ink-500">Herkunft laut Händler:</span> {feed.licenseNote}</p>
              <p className="text-ink-600">
                {DEAL_FEED_FORMAT_LABELS[feed.format]} · alle {feed.intervalHours} h · {feed.dealCount} Angebote · Vergleichspreise{' '}
                {feed.referencePricesConfirmed ? 'bestätigt' : 'nicht bestätigt (werden nicht übernommen)'}
                {feed.lastFetchedAt ? ` · zuletzt ${formatDateTime(feed.lastFetchedAt)}` : ''}
              </p>
              {feed.lastError ? <p className="font-medium text-danger-600">{feed.lastError} ({feed.consecutiveFailures}× in Folge)</p> : null}
              {feed.lastImport ? (
                <p className="text-ink-600">
                  Letzter Lauf:{' '}
                  <Link href={`/admin/deals/importe/${feed.lastImport.id}`} className="font-semibold text-brand-700 hover:underline">{formatDateTime(feed.lastImport.createdAt)}</Link>{' '}
                  {importCountsText(feed.lastImport)}
                </p>
              ) : null}
              <ActionForm action={reviewDealFeedAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <input type="hidden" name="id" value={feed.id} />
                <Field label="Notiz an den Händler (optional)" className="flex-1">
                  <Input name="note" maxLength={500} defaultValue={feed.reviewNote ?? ''} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  {feed.status !== 'APPROVED' ? <SubmitButton size="sm" name="decision" value="APPROVE">Freigeben</SubmitButton> : null}
                  {feed.status !== 'REJECTED' ? <SubmitButton size="sm" variant="outline" name="decision" value="REJECT">Ablehnen</SubmitButton> : null}
                  {feed.status === 'APPROVED' || feed.status === 'FAILING' ? <SubmitButton size="sm" variant="ghost" name="decision" value="PAUSE">Anhalten</SubmitButton> : null}
                </div>
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
