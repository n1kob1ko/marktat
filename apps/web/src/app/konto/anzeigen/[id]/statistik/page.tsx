import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { buttonClasses, Card, Skeleton } from '@marktat/ui';
import { formatDate, formatDateTime, type ListingStats } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { ListingStatusBadge } from '@/components/listing-status-badge';
import { ViewsChart } from '@/components/stats/views-chart';

export const metadata: Metadata = { title: 'Statistik meiner Anzeige', robots: { index: false } };

export default function ListingStatsPage({ params }: PageProps<'/konto/anzeigen/[id]/statistik'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Stats params={params} />
    </Suspense>
  );
}

async function Stats({ params }: Pick<PageProps<'/konto/anzeigen/[id]/statistik'>, 'params'>) {
  const { id } = await params;
  const { token } = await requireUser(`/konto/anzeigen/${id}/statistik`);
  let stats: ListingStats;
  try {
    stats = await api<ListingStats>(`/listings/${encodeURIComponent(id)}/stats`, { token, cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const views30 = stats.viewsByDay.reduce((sum, day) => sum + day.views, 0);
  const tiles = [
    { label: 'Aufrufe gesamt', value: stats.totalViews },
    { label: 'Aufrufe (30 Tage)', value: views30 },
    { label: 'Auf Merklisten', value: stats.favorites },
    { label: 'Anfragen', value: stats.inquiries },
    { label: 'Interessierte Personen', value: stats.interestedPeople },
  ];
  const dates = [
    { label: 'Erstellt', value: formatDate(stats.createdAt) },
    { label: 'Veröffentlicht', value: stats.publishedAt ? formatDate(stats.publishedAt) : '–' },
    { label: 'Online bis', value: stats.expiresAt ? formatDate(stats.expiresAt) : '–' },
    { label: 'Zuletzt hochgeschoben', value: stats.bumpedAt ? formatDateTime(stats.bumpedAt) : '–' },
  ];

  return (
    <div className="space-y-5">
      <Link href="/konto/anzeigen" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Meine Anzeigen
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <ListingStatusBadge status={stats.status} />
          <h2 className="mt-2 truncate font-sans text-xl font-semibold tracking-normal text-ink-950">{stats.title}</h2>
        </div>
        <Link href={`/konto/anzeigen/${stats.listingId}/leistungen`} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
          <Sparkles className="size-4" aria-hidden="true" /> Leistungen
        </Link>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile) => (
          <Card key={tile.label} className="p-4">
            <dt className="text-xs font-medium text-ink-500">{tile.label}</dt>
            <dd className="mt-1 text-2xl font-bold text-ink-950 tabular-nums">{tile.value.toLocaleString('de-AT')}</dd>
          </Card>
        ))}
      </dl>

      <Card className="p-5">
        <h3 className="font-sans text-base font-semibold tracking-normal text-ink-900">Aufrufe pro Tag (letzte 30 Tage)</h3>
        <ViewsChart days={stats.viewsByDay} />
        <p className="mt-3 text-xs leading-relaxed text-ink-500">
          Gezählt wird jede Person höchstens einmal pro Tag. Deine eigenen Aufrufe, Aufrufe unseres Teams und erkannte Bots zählen nicht.
          {stats.countingSince ? ` Aufrufe werden seit ${formatDate(stats.countingSince)} pro Tag erfasst.` : ''}
        </p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <h3 className="font-sans text-base font-semibold tracking-normal text-ink-900">Daten</h3>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            {dates.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-ink-500">{row.label}</dt>
                <dd className="text-ink-900 tabular-nums">{row.value}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card className="p-5">
          <h3 className="font-sans text-base font-semibold tracking-normal text-ink-900">Aktive Leistungen</h3>
          {stats.activePromotions.length ? (
            <ul className="mt-3 space-y-2 text-sm">
              {stats.activePromotions.map((promotion) => (
                <li key={promotion.code} className="flex justify-between gap-4">
                  <span className="text-ink-900">{promotion.name}</span>
                  <span className="text-ink-600 tabular-nums">{promotion.endsAt ? `bis ${formatDateTime(promotion.endsAt)}` : 'läuft'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-ink-600">Gerade keine. Hervorheben, Top-Anzeige und Hochschieben findest du unter „Leistungen“.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
