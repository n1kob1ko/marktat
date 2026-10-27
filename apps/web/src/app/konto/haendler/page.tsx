import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Alert, buttonClasses, Card, Skeleton } from '@marktat/ui';
import type { DealerDashboard } from '@marktat/shared';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';

export const metadata: Metadata = { title: 'Händler-Dashboard', robots: { index: false } };

export default function DealerDashboardPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const { user, token } = await requireUser('/konto/haendler');
  if (user.accountType !== 'BUSINESS') {
    return (
      <Card className="p-6 text-sm text-ink-700">
        Das Händler-Dashboard gibt es für gewerbliche Konten. Bei Fragen zu einem Gewerbekonto hilft dir unser Team über das{' '}
        <Link href="/impressum" className="font-semibold text-brand-700 hover:underline">Impressum</Link> weiter.
      </Card>
    );
  }
  const data = await api<DealerDashboard>('/me/dealer-dashboard', { token, cache: 'no-store' });
  const tiles = [
    { label: 'Aktive Anzeigen', value: data.listings.active },
    { label: 'Pausiert', value: data.listings.paused },
    { label: 'Abgelaufen', value: data.listings.expired },
    { label: 'Entwürfe', value: data.listings.drafts },
    { label: 'Aufrufe (30 Tage)', value: data.views30d },
    { label: 'Aufrufe gesamt', value: data.totalViews },
    { label: 'Auf Merklisten', value: data.favorites },
    { label: 'Anfragen (30 Tage)', value: data.inquiries30d },
    { label: 'Aktive Top-Anzeigen', value: data.activeTop },
    { label: 'Aktive Hervorhebungen', value: data.activeHighlights },
    { label: 'Hochgeschoben (30 Tage)', value: data.bumps30d },
    { label: 'Anfragen gesamt', value: data.inquiries },
  ];

  return (
    <div className="space-y-6">
      {!data.profileComplete ? (
        <Alert tone="warning" title="Dein Händlerprofil ist noch unvollständig">
          Es fehlt: {data.missingProfileFields.join(', ')}. <Link href="/konto" className="font-semibold underline">Profil ergänzen</Link>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-sans text-lg font-semibold tracking-normal">Überblick</h2>
        <div className="flex flex-wrap gap-2">
          <Link href={`/haendler/${user.id}`} className={buttonClasses({ variant: 'outline', size: 'sm' })}>Öffentliches Profil</Link>
          <Link href="/konto/anzeigen" className={buttonClasses({ size: 'sm' })}>Anzeigen verwalten</Link>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Card key={tile.label} className="p-4">
            <dt className="text-xs font-medium text-ink-500">{tile.label}</dt>
            <dd className="mt-1 text-2xl font-bold text-ink-950 tabular-nums">{tile.value.toLocaleString('de-AT')}</dd>
          </Card>
        ))}
      </dl>
      <p className="text-xs text-ink-500">Aufrufe ohne deine eigenen, ohne Team und ohne erkannte Bots; jede Person zählt höchstens einmal pro Tag und Anzeige.</p>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card className="overflow-hidden">
          <h3 className="px-5 pt-5 font-sans text-base font-semibold tracking-normal">Meistgesehene aktive Anzeigen</h3>
          {data.topListings.length ? (
            <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Meistgesehene aktive Anzeigen (seitlich scrollbar)">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <thead className="text-xs text-ink-500">
                  <tr>
                    <th scope="col" className="px-5 py-2 font-medium">Anzeige</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Aufrufe</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Merkliste</th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">Anfragen</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topListings.map((listing) => (
                    <tr key={listing.id} className="border-t border-line">
                      <td className="max-w-0 truncate px-5 py-2.5">
                        <Link href={`/konto/anzeigen/${listing.id}/statistik`} className="font-semibold text-ink-900 hover:text-brand-700 hover:underline">
                          {listing.title}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{listing.views.toLocaleString('de-AT')}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{listing.favorites.toLocaleString('de-AT')}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums">{listing.inquiries.toLocaleString('de-AT')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-5 pt-2 pb-5 text-sm text-ink-600">Noch keine aktiven Anzeigen.</p>
          )}
        </Card>
        <Card className="p-5">
          <h3 className="font-sans text-base font-semibold tracking-normal">Kontingent</h3>
          <ul className="mt-3 space-y-3 text-sm">
            {data.usage.map((usage) => (
              <li key={usage.code}>
                <p className="font-semibold text-ink-900">{usage.name}</p>
                <p className="text-ink-600">
                  {usage.maxActivePerUser !== null ? `${usage.active}/${usage.maxActivePerUser} gleichzeitig · ` : ''}
                  {usage.maxPerPeriod !== null ? `${usage.usedInPeriod}/${usage.maxPerPeriod} in ${usage.periodDays} Tagen` : `${usage.usedInPeriod} in ${usage.periodDays} Tagen`}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-ink-500">Händlerpakete mit eigenen Kontingenten sind vorbereitet und folgen später.</p>
        </Card>
      </div>
    </div>
  );
}
