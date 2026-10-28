import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { BadgeCheck, BadgeInfo, CalendarDays, ExternalLink, Flag, Globe, ImageIcon, MapPin, Pencil, RefreshCw, ShieldCheck, Store, Truck } from 'lucide-react';
import { Alert, Badge, buttonClasses, Card, Container, Skeleton } from '@marktat/ui';
import {
  DEAL_AVAILABILITY_LABELS,
  DEAL_IMAGE_RIGHTS_LABELS,
  DEAL_SOURCE_LABELS,
  DEAL_STATUS_LABELS,
  MODERATION_ACTION_LABELS,
  formatDate,
  formatPriceCents,
  type DealDetail,
} from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { getAccessToken, getCurrentUser, isStaff } from '@/lib/auth';
import { dealValidity, endsSoon, referenceExplanation } from '@/lib/deals';
import { metaDescription } from '@/lib/seo';
import { FlashMessage } from '@/components/flash-message';
import { ItemFavoriteButton } from '@/components/favorites/item-favorite-button';
import { DealPrice, DiscountBadge } from '@/components/deals/deal-price';

async function loadDeal(id: string, token: string | null) {
  try {
    return await api<DealDetail>(`/deals/${id}`, { token: token ?? undefined, cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function generateMetadata({ params }: PageProps<'/deals/[id]'>): Promise<Metadata> {
  const [{ id }, token] = await Promise.all([params, getAccessToken()]);
  const deal = await loadDeal(id, token).catch(() => null);
  if (!deal) return { title: 'Angebot nicht gefunden', robots: { index: false } };
  const description = metaDescription(deal.description, `${deal.title} bei ${deal.merchant.name} für ${formatPriceCents(deal.priceCents)} – ${dealValidity(deal)}`);
  return {
    title: `${deal.title} – Angebot von ${deal.merchant.name}`,
    description,
    alternates: { canonical: `/deals/${deal.id}` },
    // Nur aktuelle Angebote gehören in Suchmaschinen
    ...(deal.status === 'ACTIVE' ? {} : { robots: { index: false, follow: false } }),
    openGraph: {
      type: 'website',
      title: deal.title,
      description,
      url: `/deals/${deal.id}`,
      ...(deal.largeImageUrl ? { images: [{ url: deal.largeImageUrl, alt: deal.title }] } : {}),
    },
  };
}

export default function DealPage({ params, searchParams }: PageProps<'/deals/[id]'>) {
  return (
    <Container className="py-8 sm:py-10">
      <Suspense fallback={<Skeleton className="h-[36rem]" />}>
        <DealContent params={params} searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

async function DealContent({ params, searchParams }: Pick<PageProps<'/deals/[id]'>, 'params' | 'searchParams'>) {
  const [{ id }, query, token] = await Promise.all([params, searchParams, getAccessToken()]);
  const deal = await loadDeal(id, token);
  if (!deal) notFound();
  const staff = token ? isStaff(await getCurrentUser()) : false;
  const hinweis = typeof query.hinweis === 'string' ? query.hinweis : undefined;
  const reference = referenceExplanation(deal);
  const publicView = deal.status === 'ACTIVE';
  const online = deal.channel !== 'LOCAL';

  return (
    <div className="space-y-6">
      <FlashMessage hinweis={hinweis} />
      {deal.isOwner || staff ? <OwnerBar deal={deal} staff={staff} /> : null}

      <nav aria-label="Brotkrümel" className="text-sm text-ink-500">
        <Link href="/deals" className="hover:text-brand-700 hover:underline">Deals & Angebote</Link>
        <span aria-hidden="true"> / </span>
        <Link href={`/deals?kategorie=${deal.category.slug}`} className="hover:text-brand-700 hover:underline">
          {deal.category.name}
        </Link>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
            {deal.largeImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- Bild ist serverseitig verkleinert (WebP)
              <img src={deal.largeImageUrl} alt={deal.title} className="mx-auto max-h-[28rem] w-full object-contain" />
            ) : (
              <div className="flex aspect-[4/3] max-h-[28rem] w-full items-center justify-center bg-canvas">
                <ImageIcon className="size-10 text-ink-300" aria-hidden="true" />
              </div>
            )}
            <DiscountBadge percent={deal.discountPercent} className="absolute top-3 left-3 text-base" />
          </div>
          {deal.imageCredit || deal.imageRights ? (
            <p className="-mt-4 text-xs text-ink-500">
              Bild: {deal.imageRights ? DEAL_IMAGE_RIGHTS_LABELS[deal.imageRights] : ''}
              {deal.imageCredit ? ` · ${deal.imageCredit}` : ''}
            </p>
          ) : null}

          <Card className="p-5 sm:p-7">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="accent">Angebot</Badge>
              <Badge tone="brand">Gewerblicher Händler</Badge>
              {deal.availability !== 'UNKNOWN' ? <Badge tone="neutral">{DEAL_AVAILABILITY_LABELS[deal.availability]}</Badge> : null}
              {!publicView ? <Badge tone="warning">{DEAL_STATUS_LABELS[deal.status]}</Badge> : null}
            </div>
            <h1 className="mt-3 text-2xl leading-tight font-bold text-ink-950 sm:text-3xl">{deal.title}</h1>
            {deal.brand ? <p className="mt-1 text-sm text-ink-600">Marke: {deal.brand}</p> : null}
            <DealPrice deal={deal} size="lg" className="mt-4" />
            {reference ? (
              <p className="mt-2 flex gap-1.5 text-sm text-ink-600">
                <BadgeInfo className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  Vergleichspreis {reference}.
                  {deal.referencePriceEvidenceUrl ? (
                    <>
                      {' '}
                      <a href={deal.referencePriceEvidenceUrl} rel="nofollow noopener noreferrer" target="_blank" className="font-semibold text-brand-700 hover:underline">
                        Beleg ansehen
                      </a>
                    </>
                  ) : null}
                </span>
              </p>
            ) : null}
            {deal.lowestRecordedPrice30d !== null ? (
              <p className="mt-1 text-sm text-ink-600">
                Niedrigster bei MarktAT erfasster Preis in den 30 Tagen vor der letzten Preisänderung: {formatPriceCents(deal.lowestRecordedPrice30d)}
              </p>
            ) : null}
            {deal.shippingNote ? (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-600">
                <Truck className="size-4" aria-hidden="true" /> {deal.shippingNote}
              </p>
            ) : null}

            <dl className="mt-5 grid gap-2 text-sm text-ink-700 sm:grid-cols-2">
              <div className="flex items-center gap-1.5">
                <CalendarDays className="size-4 shrink-0 text-ink-500" aria-hidden="true" />
                <dt className="sr-only">Gültigkeit</dt>
                <dd className={endsSoon(deal) ? 'font-semibold text-accent-700' : undefined}>
                  {dealValidity(deal)} ({formatDate(deal.startsAt)} – {formatDate(deal.endsAt)})
                </dd>
              </div>
              <div className="flex items-center gap-1.5">
                {online ? <Globe className="size-4 shrink-0 text-ink-500" aria-hidden="true" /> : <MapPin className="size-4 shrink-0 text-ink-500" aria-hidden="true" />}
                <dt className="sr-only">Wo</dt>
                <dd>{deal.channel === 'ONLINE' ? 'Online' : deal.channel === 'LOCAL' ? 'Im Geschäft' : 'Online und im Geschäft'}</dd>
              </div>
              {deal.lastVerifiedAt ? (
                <div className="flex items-center gap-1.5">
                  <RefreshCw className="size-4 shrink-0 text-ink-500" aria-hidden="true" />
                  <dt className="sr-only">Zuletzt geprüft</dt>
                  <dd>Zuletzt vom Händler bestätigt am {formatDate(deal.lastVerifiedAt)}</dd>
                </div>
              ) : null}
              <div className="flex items-center gap-1.5">
                <BadgeCheck className="size-4 shrink-0 text-ink-500" aria-hidden="true" />
                <dt className="sr-only">Herkunft</dt>
                <dd>{DEAL_SOURCE_LABELS[deal.source]}</dd>
              </div>
            </dl>

            {deal.description ? (
              <>
                <h2 className="mt-8 font-sans text-lg font-semibold tracking-normal">Beschreibung</h2>
                <div className="mt-3 text-[0.9375rem] leading-relaxed whitespace-pre-line text-ink-800">{deal.description}</div>
              </>
            ) : null}
            {deal.gtin ? <p className="mt-4 text-xs text-ink-500">GTIN/EAN: {deal.gtin}</p> : null}
          </Card>

          {deal.stores.length ? (
            <Card className="p-5 sm:p-7">
              <h2 className="font-sans text-lg font-semibold tracking-normal">Gilt in {deal.stores.length === 1 ? 'dieser Filiale' : `${deal.stores.length} Filialen`}</h2>
              <ul className="mt-4 divide-y divide-line">
                {deal.stores.map((store) => (
                  <li key={store.id} className="py-3 first:pt-0 last:pb-0">
                    <p className="font-semibold text-ink-900">{store.name}</p>
                    <p className="text-sm text-ink-600">
                      {store.street}, {store.location.postalCode} {store.location.place}
                    </p>
                    {store.openingHours ? <p className="mt-0.5 text-xs whitespace-pre-line text-ink-500">{store.openingHours}</p> : null}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-ink-500">Verfügbarkeit in der einzelnen Filiale bitte direkt beim Händler erfragen.</p>
            </Card>
          ) : null}

          {deal.priceHistory.length > 1 ? (
            <Card className="p-5 sm:p-7">
              <h2 className="font-sans text-lg font-semibold tracking-normal">Erfasste Preise</h2>
              <p className="mt-1 text-sm text-ink-600">Preise, die der Händler hier eingetragen hat – keine Marktpreise und keine Schätzung.</p>
              <table className="mt-4 w-full text-left text-sm">
                <thead className="text-xs text-ink-500">
                  <tr>
                    <th scope="col" className="py-1.5 font-medium">Seit</th>
                    <th scope="col" className="py-1.5 text-right font-medium">Preis</th>
                  </tr>
                </thead>
                <tbody>
                  {deal.priceHistory.map((point) => (
                    <tr key={point.recordedAt} className="border-t border-line">
                      <td className="py-2">{formatDate(point.recordedAt)}</td>
                      <td className="py-2 text-right tabular-nums">{formatPriceCents(point.priceCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center gap-3">
              {deal.merchant.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- Logo ist serverseitig verkleinert (WebP)
                <img src={deal.merchant.logoUrl} alt="" width={48} height={48} className="size-12 shrink-0 rounded-full border border-line bg-surface object-contain" />
              ) : (
                <span className="flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  <Store className="size-6" aria-hidden="true" />
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink-900">{deal.merchant.name}</p>
                <p className="text-sm text-ink-500">Gewerblicher Händler</p>
              </div>
            </div>
            {online && deal.url && publicView ? (
              <>
                <a
                  href={`/deals/${deal.id}/zum-angebot`}
                  rel={deal.isAffiliateLink ? 'sponsored nofollow noopener' : 'nofollow noopener'}
                  target="_blank"
                  className={buttonClasses({ size: 'lg', className: 'mt-5 w-full' })}
                >
                  Zum Angebot <ExternalLink className="size-4.5" aria-hidden="true" />
                </a>
                <p className="mt-2 text-center text-xs text-ink-500">
                  Weiter zu {deal.urlHost}
                  {deal.isAffiliateLink ? ' · Werbelink: Der Händler oder Dritte erhalten eventuell eine Provision.' : ''}
                </p>
              </>
            ) : null}
            {!deal.isOwner && (publicView || deal.isFavorite) ? <ItemFavoriteButton kind="deal" id={deal.id} title={deal.title} initial={deal.isFavorite} className="mt-3" /> : null}
            <p className="mt-4 text-xs leading-relaxed text-ink-500">
              Kauf und Bezahlung erfolgen direkt beim Händler. MarktAT ist nicht Verkäufer und haftet nicht für Preis und Verfügbarkeit; maßgeblich sind die Angaben im Geschäft
              bzw. im Online-Shop.
            </p>
            <Link href={`/haendler/${deal.merchant.id}`} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
              <Store className="size-4" aria-hidden="true" /> Händlerprofil
            </Link>
            <br />
            <Link href={`/deals?haendler=${deal.merchant.id}`} className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
              Alle Angebote dieses Händlers
            </Link>
          </Card>
          {deal.relatedCategoryPath ? (
            <Link href={`/suche?kategorie=${deal.relatedCategoryPath}`} className="block rounded-xl border border-line bg-surface p-4 text-sm text-ink-700 hover:border-brand-300">
              Lieber gebraucht? <span className="font-semibold text-brand-700">Passende Kleinanzeigen ansehen</span>
            </Link>
          ) : null}
          {deal.isOwner ? null : (
            <Link href={`/melden?deal=${deal.id}`} className="flex items-center justify-center gap-1.5 text-sm text-ink-500 hover:text-danger-600 hover:underline">
              <Flag className="size-4" aria-hidden="true" /> Angebot melden
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}

function OwnerBar({ deal, staff }: { deal: DealDetail; staff: boolean }) {
  return (
    <div className="space-y-3">
      {deal.moderation ? (
        <Alert tone="warning" title={MODERATION_ACTION_LABELS[deal.moderation.action]}>
          {deal.moderation.statement}{' '}
          {deal.isOwner ? (
            <Link href={`/konto/entscheidungen/${deal.moderation.decisionId}`} className="font-semibold underline">
              Begründung und Einspruch
            </Link>
          ) : null}
        </Alert>
      ) : deal.reviewReason && deal.status === 'PENDING_REVIEW' ? (
        <Alert tone="info" title="In Prüfung">{deal.reviewReason}</Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3">
        <span className="text-sm text-ink-700">
          Status: <strong>{DEAL_STATUS_LABELS[deal.status]}</strong>
          {deal.linkStatus === 'BROKEN' ? ' · Link nicht erreichbar' : ''}
        </span>
        <span className="flex-1" />
        {deal.isOwner ? (
          <Link href={`/konto/deals/${deal.id}`} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
            <Pencil className="size-4" aria-hidden="true" /> Verwalten
          </Link>
        ) : null}
        {staff ? (
          <Link href={`/admin/deals/${deal.id}`} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
            <ShieldCheck className="size-4" aria-hidden="true" /> Moderieren
          </Link>
        ) : null}
      </div>
    </div>
  );
}
