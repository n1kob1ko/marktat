import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ExternalLink, FileUp, ImageIcon, MapPin, Plus, Store } from 'lucide-react';
import { Alert, buttonClasses, Card, Skeleton } from '@marktat/ui';
import { DEAL_CHANNEL_LABELS, formatDate, formatPriceCents, type MerchantDealOverview } from '@marktat/shared';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { FlashMessage } from '@/components/flash-message';
import { DealActions } from '@/components/deals/deal-actions';
import { DealStatusBadge } from '@/components/deals/deal-status-badge';
import { CertifyDealerForm } from './forms';

export const metadata: Metadata = { title: 'Meine Deals', robots: { index: false } };

export default function MyDealsPage({ searchParams }: PageProps<'/konto/deals'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <MyDeals searchParams={searchParams} />
    </Suspense>
  );
}

const COUNT_LABELS: [keyof MerchantDealOverview['counts'], string][] = [
  ['active', 'Aktiv'],
  ['scheduled', 'Geplant'],
  ['unverified', 'Bestätigung nötig'],
  ['review', 'In Prüfung'],
  ['paused', 'Pausiert'],
  ['drafts', 'Entwürfe'],
  ['expired', 'Abgelaufen'],
];

async function MyDeals({ searchParams }: Pick<PageProps<'/konto/deals'>, 'searchParams'>) {
  const [{ user, token }, params] = await Promise.all([requireUser('/konto/deals'), searchParams]);
  const hinweis = typeof params.hinweis === 'string' ? params.hinweis : undefined;

  if (user.accountType !== 'BUSINESS') {
    return (
      <Card className="space-y-2 p-6 text-sm text-ink-700">
        <h2 className="font-sans text-lg font-semibold tracking-normal text-ink-950">Deals sind für Händler</h2>
        <p>
          Angebote im Bereich <Link href="/deals" className="font-semibold text-brand-700 hover:underline">Deals & Angebote</Link> können nur
          gewerbliche Konten mit vollständigen Firmenangaben einstellen. Privat verkaufst du am besten mit einer{' '}
          <Link href="/inserieren" className="font-semibold text-brand-700 hover:underline">Anzeige</Link>.
        </p>
      </Card>
    );
  }

  const { eligibility, deals, counts } = await api<MerchantDealOverview>('/me/deals', { token, cache: 'no-store' });

  return (
    <div className="space-y-6">
      <FlashMessage hinweis={hinweis} />
      {eligibility.blocked ? (
        <Alert tone="danger" title="Dein Konto ist für Deals gesperrt">
          Du kannst keine neuen Angebote veröffentlichen. Die Begründung und die Möglichkeit zum Einspruch findest du unter{' '}
          <Link href="/konto/entscheidungen" className="font-semibold underline">Entscheidungen</Link>.
        </Alert>
      ) : eligibility.missingFields.length ? (
        <Alert tone="warning" title="Bitte ergänze zuerst deine Firmenangaben">
          Für Deals fehlt noch: {eligibility.missingFields.join(', ')}. <Link href="/konto" className="font-semibold underline">Profil ergänzen</Link>
        </Alert>
      ) : !eligibility.certified ? (
        <Card className="space-y-3 p-5">
          <h2 className="font-sans text-base font-semibold tracking-normal">Einmalige Bestätigung</h2>
          <p className="text-sm text-ink-600">
            Bevor du Angebote veröffentlichst, bestätige bitte deine Angaben als gewerbliche:r Anbieter:in. Entwürfe kannst du schon vorher anlegen.
          </p>
          <CertifyDealerForm />
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-sans text-lg font-semibold tracking-normal">Meine Deals</h2>
        <div className="flex flex-wrap gap-2">
          <Link href="/konto/deals/filialen" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
            <Store className="size-4" aria-hidden="true" /> Filialen
          </Link>
          <Link href="/konto/deals/import" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
            <FileUp className="size-4" aria-hidden="true" /> Importieren
          </Link>
          {!eligibility.blocked ? (
            <Link href="/konto/deals/neu" className={buttonClasses({ size: 'sm' })}>
              <Plus className="size-4" aria-hidden="true" /> Neues Angebot
            </Link>
          ) : null}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {COUNT_LABELS.map(([key, label]) => (
          <Card key={key} className="p-3">
            <dt className="text-xs font-medium text-ink-500">{label}</dt>
            <dd className="mt-1 text-xl font-bold text-ink-950 tabular-nums">{counts[key]}</dd>
          </Card>
        ))}
      </dl>
      <p className="text-xs text-ink-500">
        Ein Deal erscheint nur, solange du ihn regelmäßig bestätigst (spätestens alle 14 Tage mit „Gilt weiterhin“, Bearbeiten zählt auch) und
        er nicht abgelaufen ist. So sehen Käufer:innen keine veralteten Angebote.
      </p>

      {deals.length === 0 ? (
        <Card className="px-6 py-12 text-center">
          <p className="font-semibold text-ink-900">Du hast noch keine Deals.</p>
          <p className="mt-1 text-sm text-ink-500">Stelle dein erstes Angebot ein – online, in deinen Filialen oder beides.</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {deals.map((deal) => (
            <li key={deal.id}>
              <Card className="flex flex-col gap-4 p-4 sm:flex-row">
                <Link href={`/konto/deals/${deal.id}`} className="shrink-0">
                  {deal.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Bild ist serverseitig verkleinert (WebP)
                    <img src={deal.imageUrl} alt="" width={128} height={96} className="h-24 w-32 rounded-lg bg-canvas object-contain" />
                  ) : (
                    <span className="flex h-24 w-32 items-center justify-center rounded-lg bg-canvas text-ink-300">
                      <ImageIcon className="size-6" aria-hidden="true" />
                    </span>
                  )}
                </Link>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <DealStatusBadge status={deal.status} />
                    {deal.linkStatus === 'BROKEN' ? <span className="text-xs font-semibold text-danger-600">Link nicht erreichbar</span> : null}
                    {deal.source !== 'MANUAL' ? <span className="text-xs text-ink-500">aus {deal.source === 'CSV' ? 'CSV-Import' : 'Feed'}</span> : null}
                  </div>
                  <Link href={`/konto/deals/${deal.id}`} className="block truncate font-semibold text-ink-950 hover:text-brand-700 hover:underline">
                    {deal.title}
                  </Link>
                  <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-600">
                    <span className="font-semibold text-ink-900">{formatPriceCents(deal.priceCents)}</span>
                    {deal.discountPercent !== null ? <span>−{deal.discountPercent} %</span> : null}
                    <span className="inline-flex items-center gap-1">
                      {deal.channel === 'ONLINE' ? <ExternalLink className="size-3.5" aria-hidden="true" /> : <MapPin className="size-3.5" aria-hidden="true" />}
                      {DEAL_CHANNEL_LABELS[deal.channel]}
                    </span>
                    <span>
                      {formatDate(deal.startsAt)} – {formatDate(deal.endsAt)}
                    </span>
                    <span>
                      {deal.viewCount.toLocaleString('de-AT')} Aufrufe · {deal.clickCount.toLocaleString('de-AT')} Klicks
                    </span>
                  </p>
                  {deal.verifyBy && (deal.status === 'ACTIVE' || deal.status === 'UNVERIFIED') ? (
                    <p className={deal.status === 'UNVERIFIED' ? 'text-sm font-semibold text-warning-700' : 'text-xs text-ink-500'}>
                      {deal.status === 'UNVERIFIED' ? 'Nicht mehr sichtbar, bis du es bestätigst.' : `Bitte bis ${formatDate(deal.verifyBy)} bestätigen.`}
                    </p>
                  ) : null}
                  {deal.reviewReason && deal.status === 'PENDING_REVIEW' ? <p className="text-xs text-ink-500">{deal.reviewReason}</p> : null}
                  <DealActions id={deal.id} status={deal.status} back="list" compact />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
