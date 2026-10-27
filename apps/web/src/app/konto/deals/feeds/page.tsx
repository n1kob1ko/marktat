import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Badge, type BadgeTone, buttonClasses, Card, Skeleton } from '@marktat/ui';
import { DEAL_FEED_FORMAT_LABELS, DEAL_FEED_STATUS_LABELS, formatDateTime, type DealFeedStatus, type DealFeedView } from '@marktat/shared';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { importCountsText } from '@/lib/deal-imports';
import { FlashMessage } from '@/components/flash-message';
import { FeedForm, FeedOpButton } from '../import/forms';

export const metadata: Metadata = { title: 'Produktfeeds', robots: { index: false } };

const STATUS_TONES: Record<DealFeedStatus, BadgeTone> = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', PAUSED: 'neutral', FAILING: 'danger' };

export default function FeedsPage({ searchParams }: PageProps<'/konto/deals/feeds'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Feeds searchParams={searchParams} />
    </Suspense>
  );
}

async function Feeds({ searchParams }: Pick<PageProps<'/konto/deals/feeds'>, 'searchParams'>) {
  const [{ user, token }, params] = await Promise.all([requireUser('/konto/deals/feeds'), searchParams]);
  if (user.accountType !== 'BUSINESS') {
    return <Card className="p-6 text-sm text-ink-700">Produktfeeds gibt es nur für gewerbliche Konten.</Card>;
  }
  const feeds = await api<DealFeedView[]>('/me/deal-feeds', { token, cache: 'no-store' });
  const hinweis = typeof params.hinweis === 'string' ? params.hinweis : undefined;
  const editId = typeof params.bearbeiten === 'string' ? params.bearbeiten : undefined;
  const editing = editId ? feeds.find((f) => f.id === editId) : undefined;

  return (
    <div className="space-y-6">
      <FlashMessage hinweis={hinweis} />
      <div>
        <Link href="/konto/deals/import" className="text-sm font-semibold text-brand-700 hover:underline">← Importe</Link>
        <h2 className="mt-2 font-sans text-xl font-semibold tracking-normal">Produktfeeds</h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-600">
          Hinterlege die Adresse deines eigenen Produktfeeds (CSV mit den Spalten der Vorlage oder JSON). Unser Team prüft Herkunft und Nutzungsrechte;
          erst danach rufen wir ihn ab – höchstens im eingestellten Abstand. Angebote, die nicht mehr im Feed stehen, werden beendet. Schlägt der
          Abruf mehrmals hintereinander fehl, wird der Feed angehalten.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_26rem]">
        <div>
          {feeds.length === 0 ? (
            <Card className="px-6 py-10 text-center text-sm text-ink-600">Noch keine Feeds hinterlegt.</Card>
          ) : (
            <ul className="space-y-3">
              {feeds.map((feed) => (
                <li key={feed.id}>
                  <Card className="space-y-3 p-4 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink-950">{feed.name}</span>
                      <Badge tone={STATUS_TONES[feed.status]}>{DEAL_FEED_STATUS_LABELS[feed.status]}</Badge>
                    </div>
                    <p className="break-all text-ink-600">{feed.url}</p>
                    <dl className="grid gap-x-4 gap-y-1 text-ink-600 sm:grid-cols-2">
                      <div><dt className="inline text-ink-500">Format: </dt><dd className="inline">{DEAL_FEED_FORMAT_LABELS[feed.format]}</dd></div>
                      <div><dt className="inline text-ink-500">Abruf: </dt><dd className="inline">alle {feed.intervalHours} Stunden</dd></div>
                      <div><dt className="inline text-ink-500">Angebote: </dt><dd className="inline">{feed.dealCount}</dd></div>
                      <div><dt className="inline text-ink-500">Zuletzt abgerufen: </dt><dd className="inline">{feed.lastFetchedAt ? formatDateTime(feed.lastFetchedAt) : '–'}</dd></div>
                      {feed.nextFetchAt ? <div><dt className="inline text-ink-500">Nächster Abruf: </dt><dd className="inline">{formatDateTime(feed.nextFetchAt)}</dd></div> : null}
                    </dl>
                    {feed.lastError ? <p className="font-medium text-danger-600">Letzter Fehler: {feed.lastError}</p> : null}
                    {feed.reviewNote && (feed.status === 'REJECTED' || feed.status === 'PAUSED') ? <p className="text-ink-700">Hinweis des Teams: {feed.reviewNote}</p> : null}
                    {feed.lastImport ? (
                      <p className="text-ink-600">
                        Letzter Lauf:{' '}
                        <Link href={`/konto/deals/import/${feed.lastImport.id}`} className="font-semibold text-brand-700 hover:underline">
                          {formatDateTime(feed.lastImport.createdAt)}
                        </Link>{' '}
                        {importCountsText(feed.lastImport)}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <FeedOpButton id={feed.id} op="preview" />
                      {feed.status === 'APPROVED' || feed.status === 'FAILING' ? <FeedOpButton id={feed.id} op="pause" /> : null}
                      {(feed.status === 'PAUSED' || feed.status === 'FAILING') && feed.approvedAt ? <FeedOpButton id={feed.id} op="resume" /> : null}
                      <Link href={`/konto/deals/feeds?bearbeiten=${feed.id}`} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
                        Bearbeiten
                      </Link>
                      <FeedOpButton id={feed.id} op="delete" />
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Card className="space-y-4 p-5">
          <h3 className="font-sans text-base font-semibold tracking-normal">{editing ? 'Feed bearbeiten' : 'Neuer Feed'}</h3>
          <FeedForm key={editing?.id ?? 'neu'} feed={editing} />
          {editing ? <Link href="/konto/deals/feeds" className="text-sm font-semibold text-brand-700 hover:underline">Abbrechen</Link> : null}
        </Card>
      </div>
    </div>
  );
}
